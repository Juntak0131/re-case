"""OpenAI 호출. 모델 출력은 JSON 스키마(enum)로 묶여 있어서 판정 외의 글이 플레이어에게 나갈 수 없다."""
from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass, field
from typing import Optional

from . import prompts

log = logging.getLogger("recase.llm")

DEFAULT_MODEL = "gpt-5-mini"
FALLBACK_MODELS = ("gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini")


class LLMError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class Judgement:
    verdict: str  # YES | NO | IRRELEVANT | INVALID
    invalid_reason: str = "NONE"
    keys: list[str] = field(default_factory=list)


class Judge:
    """판정관 인터페이스. 테스트에서는 가짜 구현으로 바꿔 끼운다."""

    ready: bool = True
    model: str = ""

    def judge(self, case: dict, question: str) -> Judgement:  # pragma: no cover
        raise NotImplementedError

    def grade(self, case: dict, explanation: str) -> list[str]:  # pragma: no cover
        raise NotImplementedError


def _key_ids(case: dict) -> list[str]:
    return [k["id"] for k in case["truth"]["keys"]]


class OpenAIJudge(Judge):
    def __init__(self, api_key: Optional[str], model: Optional[str] = None):
        self.api_key = (api_key or "").strip()
        self.model = (model or "").strip() or DEFAULT_MODEL
        self.ready = bool(self.api_key)
        self._client = None
        self._lock = threading.Lock()
        # 모델별로 거부된 파라미터를 기억해서 다음 호출부터 빼고 보낸다.
        self._dropped: dict[str, set[str]] = {}

    # ---------- public ----------
    def judge(self, case: dict, question: str) -> Judgement:
        ids = _key_ids(case)
        data = self._complete(prompts.judge_messages(case, question), prompts.judge_schema(ids))
        verdict = data.get("verdict")
        if verdict not in ("YES", "NO", "IRRELEVANT", "INVALID"):
            raise LLMError(502, "판정 결과를 읽지 못했어요. 다시 질문해 주세요.")
        reason = data.get("invalid_reason") if verdict == "INVALID" else "NONE"
        if reason not in ("NOT_YES_NO", "MULTIPLE", "OFF_RULES", "NONE"):
            reason = "NOT_YES_NO"
        keys = [k for k in data.get("keys", []) if k in ids] if verdict in ("YES", "NO") else []
        log.info("judge %s | %s -> %s %s | %s", case["id"], question, verdict, keys, data.get("basis", ""))
        return Judgement(verdict=verdict, invalid_reason=reason, keys=sorted(set(keys)))

    def grade(self, case: dict, explanation: str) -> list[str]:
        ids = _key_ids(case)
        data = self._complete(prompts.grade_messages(case, explanation), prompts.grade_schema(ids))
        keys = [k for k in data.get("keys", []) if k in ids]
        log.info("grade %s -> %s | %s", case["id"], keys, data.get("basis", ""))
        return sorted(set(keys))

    # ---------- internals ----------
    def _get_client(self):
        if not self.ready:
            raise LLMError(503, "서버에 OpenAI API 키가 없어요. backend/.env 파일에 OPENAI_API_KEY를 넣고 서버를 다시 켜 주세요.")
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(api_key=self.api_key, timeout=40, max_retries=2)
        return self._client

    def _candidates(self) -> list[str]:
        seen, out = set(), []
        for m in (self.model, *FALLBACK_MODELS):
            if m not in seen:
                seen.add(m)
                out.append(m)
        return out

    def _complete(self, messages: list[dict], schema: dict) -> dict:
        import openai

        client = self._get_client()
        last_model_error = None
        for model in self._candidates():
            try:
                data = self._call(client, model, messages, schema)
            except (openai.NotFoundError, openai.PermissionDeniedError) as e:
                # 이 키로 쓸 수 없는 모델 → 다음 후보로
                log.warning("model %s unavailable: %s", model, e)
                last_model_error = e
                continue
            except openai.AuthenticationError:
                raise LLMError(502, "OpenAI API 키가 올바르지 않아요. backend/.env의 OPENAI_API_KEY를 확인해 주세요.")
            except openai.RateLimitError:
                raise LLMError(429, "AI 요청이 너무 많거나 사용 한도를 넘었어요. 잠시 뒤에 다시 시도해 주세요.")
            except (openai.APITimeoutError, openai.APIConnectionError):
                raise LLMError(504, "AI 서버와 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.")
            except openai.APIError as e:
                log.exception("openai error")
                raise LLMError(502, f"AI 서버 오류가 났어요. 잠시 뒤에 다시 시도해 주세요. ({type(e).__name__})")
            if model != self.model:
                log.warning("OPENAI_MODEL=%s 대신 %s 모델을 씁니다.", self.model, model)
                self.model = model
            return data
        raise LLMError(
            502,
            f"이 API 키로 쓸 수 있는 모델을 찾지 못했어요. backend/.env의 OPENAI_MODEL을 확인해 주세요. ({last_model_error})",
        )

    def _call(self, client, model: str, messages: list[dict], schema: dict) -> dict:
        import openai

        for _ in range(4):
            with self._lock:
                dropped = set(self._dropped.get(model, set()))
            params: dict = {"model": model, "messages": messages}
            if "response_format" in dropped:
                params["response_format"] = {"type": "json_object"}
            else:
                params["response_format"] = {"type": "json_schema", "json_schema": schema}
            reasoning = model.startswith(("gpt-5", "o1", "o3", "o4"))
            if reasoning and "reasoning_effort" not in dropped:
                params["reasoning_effort"] = "low"
            if not reasoning and "temperature" not in dropped:
                params["temperature"] = 0
            if "seed" not in dropped:
                params["seed"] = 7
            try:
                res = client.chat.completions.create(**params)
            except openai.BadRequestError as e:
                bad = self._rejected_param(e, params)
                if not bad:
                    raise
                with self._lock:
                    self._dropped.setdefault(model, set()).add(bad)
                continue
            content = (res.choices[0].message.content or "").strip()
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                start, end = content.find("{"), content.rfind("}")
                if start != -1 and end > start:
                    try:
                        return json.loads(content[start : end + 1])
                    except json.JSONDecodeError:
                        pass
                raise LLMError(502, "AI 응답을 읽지 못했어요. 다시 시도해 주세요.")
        raise LLMError(502, "AI 요청 형식이 이 모델과 맞지 않아요. OPENAI_MODEL을 바꿔 보세요.")

    @staticmethod
    def _rejected_param(e, params: dict) -> Optional[str]:
        param = (getattr(e, "param", None) or "").split(".")[0]
        text = str(e).lower()
        for name in ("temperature", "reasoning_effort", "seed", "response_format"):
            if name in params and (param == name or name in text):
                return name
        if "json_schema" in text and "response_format" in params:
            return "response_format"
        return None


_instance: Optional[Judge] = None


def get_judge() -> Judge:
    global _instance
    if _instance is None:
        _instance = OpenAIJudge(os.getenv("OPENAI_API_KEY"), os.getenv("OPENAI_MODEL"))
    return _instance
