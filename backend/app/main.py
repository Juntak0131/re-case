"""RE:CASE API 서버. 빌드된 프론트엔드(frontend/dist)가 있으면 같이 서빙한다."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import logging
import threading
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Optional
from urllib.parse import unquote

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

from . import cases, feedback, store, studio  # noqa: E402
from .game import ANSWER_LABEL, INVALID_MESSAGE, GameStore, normalize  # noqa: E402
from .llm import Judge, Judgement, LLMError, get_judge  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

MAX_QUESTION_LEN = 150
MAX_EXPLANATION_LEN = 1200
# (버킷: 횟수, 초) — IP 기준
RATE_LIMITS = {
    "ask": (30, 60),
    "generate": (6, 3600),
    "review": (30, 3600),
    "save": (30, 3600),
    "feedback": (5, 3600),
    "admin_fail": (10, 600),
}
RATE_MESSAGES = {
    "ask": "질문이 너무 빨라요. 잠시 쉬었다가 다시 물어봐 주세요.",
    "generate": "AI 사건 생성은 한 시간에 6번까지 할 수 있어요. 조금 뒤에 다시 시도해 주세요.",
    "review": "AI 검사를 너무 자주 했어요. 조금 뒤에 다시 시도해 주세요.",
    "save": "사건 저장을 너무 자주 했어요. 조금 뒤에 다시 시도해 주세요.",
    "feedback": "후기는 한 시간에 5번까지 보낼 수 있어요. 조금 뒤에 다시 시도해 주세요.",
    "admin_fail": "비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 시도해 주세요.",
}

app = FastAPI(title="RE:CASE", version="2.0.0")
games = GameStore()

_answer_cache: dict[tuple[str, str], Judgement] = {}
_cache_lock = threading.Lock()
_calls: dict[tuple[str, str], deque] = defaultdict(deque)
_rate_lock = threading.Lock()


@app.exception_handler(LLMError)
def _llm_error(_: Request, exc: LLMError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.message})


@app.exception_handler(feedback.FeedbackError)
def _feedback_error(_: Request, exc: feedback.FeedbackError):
    content = {"detail": exc.message}
    if exc.issues:
        content["issues"] = exc.issues
    return JSONResponse(status_code=exc.status, content=content)


@app.exception_handler(studio.CaseFormatError)
def _format_error(_: Request, exc: studio.CaseFormatError):
    return JSONResponse(status_code=422, content={"detail": "사건 형식에 고칠 곳이 있어요.", "issues": exc.issues})


def _rate_limit(request: Request, bucket: str = "ask") -> None:
    limit, window = RATE_LIMITS[bucket]
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    with _rate_lock:
        q = _calls[(bucket, ip)]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(429, RATE_MESSAGES[bucket])
        q.append(now)


def _game(game_id: str):
    game = games.get(game_id)
    if not game:
        raise HTTPException(404, "게임을 찾을 수 없어요. 서버가 다시 켜졌을 수 있으니 사건을 새로 시작해 주세요.")
    return game


def _case_or_404(case_id: str) -> dict:
    case = cases.get_case(case_id)
    if not case:
        raise HTTPException(404, "없는 사건이에요. 링크가 맞는지 확인해 주세요.")
    return case


def _case_version(case: dict) -> str:
    """판정 캐시 키. 사용자 사건은 수정될 수 있어서 진실 원장 내용까지 묶는다."""
    if case.get("kind") != "user":
        return case["id"]
    digest = hashlib.sha1(json.dumps(case["truth"], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
    return f"{case['id']}:{digest}"


def _owned(case_id: str, key: Optional[str]) -> dict:
    case = store.get(case_id)
    if not case:
        raise HTTPException(404, "없는 사건이에요.")
    if not store.check_key(case_id, key):
        raise HTTPException(403, "이 사건을 고칠 수 있는 수정 키가 아니에요.")
    return case


def _safety(judge: Judge, case: dict, review: Optional[dict] = None) -> None:
    flagged = judge.moderate(studio.all_text(case))
    if flagged:
        raise HTTPException(422, "게임에 넣을 수 없는 내용이 있어요. (성적인 내용, 혐오, 잔혹한 묘사 등) 내용을 고쳐 주세요.")
    if review and review.get("blocked"):
        raise HTTPException(422, f"이 사건은 만들 수 없어요: {review.get('blocked_reason') or '안전 규칙 위반'}")


class NewGame(BaseModel):
    case_id: str


class Question(BaseModel):
    question: str = Field(..., max_length=MAX_QUESTION_LEN * 2)


class Accusation(BaseModel):
    culprit_id: str
    explanation: str = Field("", max_length=MAX_EXPLANATION_LEN * 2)


class Brief(BaseModel):
    era: str = Field("", max_length=40)
    place: str = Field("", max_length=60)
    case_type: str = Field("", max_length=40)
    mood: str = Field("", max_length=40)
    difficulty: str = Field("보통", max_length=10)
    idea: str = Field("", max_length=500)


class CaseBody(BaseModel):
    case: dict


# ---------------- 게임 ----------------
@app.get("/api/health")
def health(judge: Judge = Depends(get_judge)):
    return {"ok": True, "ai_ready": judge.ready, "model": judge.model}


@app.get("/api/cases")
def list_cases():
    return [cases.summary(c) for c in cases.all_cases()]


@app.get("/api/cases/{case_id}")
def case_summary(case_id: str):
    return cases.summary(_case_or_404(case_id))


@app.post("/api/games")
def new_game(body: NewGame):
    case = _case_or_404(body.case_id)
    if case.get("kind") == "user":
        store.count_play(case["id"])
    return games.create(case).state()


@app.get("/api/games/{game_id}")
def game_state(game_id: str):
    return _game(game_id).state()


@app.post("/api/games/{game_id}/questions")
def ask(game_id: str, body: Question, request: Request, judge: Judge = Depends(get_judge)):
    question = " ".join(body.question.split())
    if not question:
        raise HTTPException(422, "질문을 입력해 주세요.")
    if len(question) > MAX_QUESTION_LEN:
        raise HTTPException(422, f"질문은 {MAX_QUESTION_LEN}자 안으로 짧게 써 주세요.")

    game = _game(game_id)
    with game.lock:
        if game.result:
            raise HTTPException(409, "이미 추리를 제출한 사건이에요.")
        repeat = game.find_repeat(question)
        if repeat:
            return {"status": "repeat", "entry": repeat.to_dict(), "remaining": game.remaining,
                    "found_keys": sorted(game.found), "message": f"{repeat.n}번에서 이미 물어본 질문이에요."}
        if game.remaining <= 0:
            raise HTTPException(409, "질문을 모두 썼어요. 이제 추리를 제출해 주세요.")
        if game.busy:
            raise HTTPException(409, "앞의 질문을 판정하는 중이에요.")
        game.busy = True

    try:
        cache_key = (_case_version(game.case), normalize(question))
        with _cache_lock:
            verdict = _answer_cache.get(cache_key)
        if verdict is None:
            _rate_limit(request, "ask")
            verdict = judge.judge(game.case, question)
            with _cache_lock:
                if len(_answer_cache) > 20000:
                    _answer_cache.clear()
                _answer_cache[cache_key] = verdict
    finally:
        with game.lock:
            game.busy = False

    if verdict.verdict == "INVALID":
        return {"status": "invalid", "message": INVALID_MESSAGE.get(verdict.invalid_reason, INVALID_MESSAGE["NOT_YES_NO"]),
                "remaining": game.remaining, "found_keys": sorted(game.found)}

    with game.lock:
        if game.result:
            raise HTTPException(409, "이미 추리를 제출한 사건이에요.")
        if game.remaining <= 0:
            raise HTTPException(409, "질문을 모두 썼어요. 이제 추리를 제출해 주세요.")
        entry, new_keys = game.add(question, verdict.verdict, verdict.keys)
        return {"status": "answered", "entry": entry.to_dict(), "label": ANSWER_LABEL[entry.answer],
                "new_keys": new_keys, "remaining": game.remaining, "found_keys": sorted(game.found)}


@app.post("/api/games/{game_id}/accusation")
def accuse(game_id: str, body: Accusation, request: Request, judge: Judge = Depends(get_judge)):
    game = _game(game_id)
    if game.result:
        return game.result
    if body.culprit_id not in {p["id"] for p in game.case["people"]}:
        raise HTTPException(422, "지목할 인물을 골라 주세요.")
    explanation = body.explanation.strip()
    if len(explanation) > MAX_EXPLANATION_LEN:
        raise HTTPException(422, f"사건의 전말은 {MAX_EXPLANATION_LEN}자 안으로 써 주세요.")

    explained: list[str] = []
    if len(explanation) >= 10:
        _rate_limit(request, "ask")
        explained = judge.grade(game.case, explanation)
    with game.lock:
        if game.result:
            return game.result
        return game.finish(body.culprit_id, explanation, explained)


# ---------------- 사건 제작실 ----------------
@app.post("/api/studio/generate")
def generate(body: Brief, request: Request, judge: Judge = Depends(get_judge)):
    brief = body.model_dump()
    if brief["difficulty"] not in studio.DIFFICULTIES:
        brief["difficulty"] = "보통"
    if judge.moderate(" / ".join(v for v in brief.values() if v)):
        raise HTTPException(422, "게임에 넣을 수 없는 내용이 있어요. (성적인 내용, 혐오, 잔혹한 묘사 등) 조건을 바꿔 주세요.")
    _rate_limit(request, "generate")
    last_error = None
    for _ in range(2):  # 형식이 어긋나면 한 번 더 만든다
        data = judge.generate(brief)
        if data.get("blocked"):
            raise HTTPException(422, f"이 조건으로는 사건을 만들 수 없어요: {data.get('blocked_reason') or '안전 규칙 위반'}")
        try:
            case = studio.from_generated(data)
            break
        except studio.CaseFormatError as e:
            last_error = e
    else:
        raise HTTPException(502, f"AI가 만든 사건 형식이 맞지 않아요. 다시 시도해 주세요. ({last_error})")
    _safety(judge, case)
    case_id, key = store.create(case, "ai")
    return {"case_id": case_id, "edit_key": key, "case": cases.summary(store.get(case_id))}


@app.post("/api/studio/review")
def review(body: CaseBody, request: Request, judge: Judge = Depends(get_judge)):
    try:
        case = studio.normalize(body.case)
    except studio.CaseFormatError as e:
        # 형식 문제는 AI를 부르지 않고 바로 알려 준다
        return {"verdict": "플레이 불가", "blocked": False, "blocked_reason": "", "issues": e.issues}
    _rate_limit(request, "review")
    result = judge.review(case)
    issues = [i for i in result.get("issues", []) if i.get("message")]
    return {"verdict": result.get("verdict", "보완 필요"), "blocked": bool(result.get("blocked")),
            "blocked_reason": result.get("blocked_reason", ""), "issues": issues}


@app.post("/api/studio/cases")
def save_case(body: CaseBody, request: Request, judge: Judge = Depends(get_judge)):
    case = studio.normalize(body.case)
    _rate_limit(request, "save")
    _safety(judge, case, judge.review(case))
    case_id, key = store.create(case, "manual")
    return {"case_id": case_id, "edit_key": key, "case": cases.summary(store.get(case_id))}


@app.get("/api/studio/cases/{case_id}")
def load_case(case_id: str, x_edit_key: Optional[str] = Header(None)):
    case = _owned(case_id, x_edit_key)
    return {"case_id": case_id, "source": case["source"], "case": studio.editable(case)}


@app.put("/api/studio/cases/{case_id}")
def update_case(case_id: str, body: CaseBody, request: Request, x_edit_key: Optional[str] = Header(None),
                judge: Judge = Depends(get_judge)):
    _owned(case_id, x_edit_key)
    case = studio.normalize(body.case)
    _rate_limit(request, "save")
    _safety(judge, case, judge.review(case))
    store.update(case_id, case)
    return {"case_id": case_id, "case": cases.summary(store.get(case_id))}


@app.delete("/api/studio/cases/{case_id}")
def delete_case(case_id: str, x_edit_key: Optional[str] = Header(None)):
    _owned(case_id, x_edit_key)
    store.delete(case_id)
    return {"ok": True}


# ---------------- 후기 설문 ----------------
@app.get("/api/feedback/form")
def feedback_form():
    return feedback.form()


@app.post("/api/feedback")
def submit_feedback(body: dict, request: Request, fb_store=Depends(feedback.get_store)):
    if body.get("website"):  # 사람 눈에 안 보이는 칸. 채워져 있으면 자동 입력 프로그램으로 보고 저장하지 않는다
        return {"ok": True}
    record = feedback.validate(body)
    _rate_limit(request, "feedback")
    fb_store.add(record)
    return {"ok": True, "id": record["id"]}


def _admin(request: Request, password: Optional[str]) -> None:
    expected = os.getenv("ADMIN_PASSWORD", "")
    if not expected:
        raise HTTPException(503, "관리자 비밀번호(ADMIN_PASSWORD)가 아직 설정되지 않았어요. Render 환경 변수에 추가해 주세요.")
    limit, window = RATE_LIMITS["admin_fail"]
    key = ("admin_fail", request.client.host if request.client else "unknown")
    now = time.time()
    with _rate_lock:
        q = _calls[key]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(429, RATE_MESSAGES["admin_fail"])
    # 화면은 한글 비밀번호도 보낼 수 있게 encodeURIComponent로 감싸서 보낸다
    password = unquote(password or "")
    if not password or not hmac.compare_digest(password.encode(), expected.encode()):
        with _rate_lock:
            _calls[key].append(now)
        raise HTTPException(401, "관리자 비밀번호가 맞지 않아요.")


@app.get("/api/admin/feedback")
def admin_feedback(request: Request, x_admin_password: Optional[str] = Header(None), fb_store=Depends(feedback.get_store)):
    _admin(request, x_admin_password)
    rows = fb_store.list()
    # 저장소는 들어온 순서대로 준다. 번호는 먼저 들어온 응답부터 1번.
    responses = [{**r, "no": i + 1, "avg": feedback.response_avg(r)} for i, r in enumerate(rows)][::-1]
    return {"store": fb_store.kind, "summary": feedback.summarize(rows), "responses": responses}


@app.get("/api/admin/feedback.csv")
def admin_feedback_csv(request: Request, x_admin_password: Optional[str] = Header(None), fb_store=Depends(feedback.get_store)):
    _admin(request, x_admin_password)
    rows = fb_store.list()
    return Response(feedback.to_csv(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename*=UTF-8''RE-CASE_feedback.csv",
                             "Cache-Control": "no-store"})


# ---------------- 프론트엔드 ----------------
DIST = BACKEND_DIR.parent / "frontend" / "dist"

if (DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "없는 API예요.")
        target = (DIST / path).resolve()
        if path and target.is_file() and DIST.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
else:

    @app.get("/", include_in_schema=False)
    def no_frontend():
        return {"message": "API 서버가 실행 중이에요. 화면은 frontend 폴더에서 `npm run dev`로 열거나, `npm run build` 후 이 서버를 다시 켜 주세요."}
