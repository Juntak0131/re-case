"""RE:CASE API 서버. 빌드된 프론트엔드(frontend/dist)가 있으면 같이 서빙한다."""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

from . import cases  # noqa: E402
from .game import ANSWER_LABEL, INVALID_MESSAGE, GameStore, normalize  # noqa: E402
from .llm import Judge, Judgement, LLMError, get_judge  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

MAX_QUESTION_LEN = 150
MAX_EXPLANATION_LEN = 1200
RATE_LIMIT = 30  # IP당 1분에 AI 호출 수

app = FastAPI(title="RE:CASE", version="1.0.0")
store = GameStore()

_answer_cache: dict[tuple[str, str], Judgement] = {}
_cache_lock = threading.Lock()
_calls: dict[str, deque] = defaultdict(deque)
_rate_lock = threading.Lock()


@app.exception_handler(LLMError)
def _llm_error(_: Request, exc: LLMError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.message})


def _rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    with _rate_lock:
        q = _calls[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= RATE_LIMIT:
            raise HTTPException(429, "질문이 너무 빨라요. 잠시 쉬었다가 다시 물어봐 주세요.")
        q.append(now)


def _game(game_id: str):
    game = store.get(game_id)
    if not game:
        raise HTTPException(404, "게임을 찾을 수 없어요. 서버가 다시 켜졌을 수 있으니 사건을 새로 시작해 주세요.")
    return game


class NewGame(BaseModel):
    case_id: str


class Question(BaseModel):
    question: str = Field(..., max_length=MAX_QUESTION_LEN * 2)


class Accusation(BaseModel):
    culprit_id: str
    explanation: str = Field("", max_length=MAX_EXPLANATION_LEN * 2)


# ---------------- API ----------------
@app.get("/api/health")
def health(judge: Judge = Depends(get_judge)):
    return {"ok": True, "ai_ready": judge.ready, "model": judge.model}


@app.get("/api/cases")
def list_cases():
    return [cases.summary(c) for c in cases.all_cases()]


@app.post("/api/games")
def new_game(body: NewGame):
    case = cases.get_case(body.case_id)
    if not case:
        raise HTTPException(404, "없는 사건이에요.")
    return store.create(case).state()


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
        cache_key = (game.case["id"], normalize(question))
        with _cache_lock:
            verdict = _answer_cache.get(cache_key)
        if verdict is None:
            _rate_limit(request)
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
        _rate_limit(request)
        explained = judge.grade(game.case, explanation)
    with game.lock:
        if game.result:
            return game.result
        return game.finish(body.culprit_id, explanation, explained)


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
