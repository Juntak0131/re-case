"""게임 세션과 점수 계산. 세션은 메모리에만 두고, 오래된 세션은 지운다."""
from __future__ import annotations

import re
import secrets
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Optional

from .cases import person_name, public_view

SESSION_TTL = 12 * 60 * 60
MAX_SESSIONS = 5000

ANSWER_LABEL = {"YES": "예", "NO": "아니오", "IRRELEVANT": "관계없음"}
INVALID_MESSAGE = {
    "NOT_YES_NO": "예/아니오로 답할 수 있게 바꿔서 물어봐 주세요. (예: “범인은 내부 사람인가요?”)",
    "MULTIPLE": "한 번에 하나씩만 물어봐 주세요.",
    "OFF_RULES": "판정관은 예/아니오로만 답해요. 직접 추리해 보세요!",
}

SCORE_CULPRIT = 40
SCORE_ACCOMPLICE = 20
SCORE_KEY = 12

RANKS = (
    (100, "완전 해결", "모든 진실을 밝혀냈어요. 이 사건은 더 이상 미제가 아닙니다."),
    (76, "명탐정", "범인과 사건의 뼈대를 정확히 짚었어요."),
    (52, "베테랑 형사", "핵심에 꽤 가까이 다가갔어요."),
    (28, "수습 형사", "실마리는 잡았지만 아직 빈칸이 많아요."),
    (0, "미궁", "사건은 다시 어둠 속으로… 다른 각도로 다시 도전해 보세요."),
)


def normalize(question: str) -> str:
    q = re.sub(r"\s+", " ", question).strip().lower()
    return re.sub(r"[\s?？!.。~…]+$", "", q)


@dataclass
class Entry:
    question: str
    answer: str  # YES | NO | IRRELEVANT
    keys: list[str]
    n: int

    def to_dict(self) -> dict:
        return {"n": self.n, "question": self.question, "answer": self.answer,
                "label": ANSWER_LABEL[self.answer], "keys": self.keys}


@dataclass
class Game:
    id: str
    case: dict
    history: list[Entry] = field(default_factory=list)
    found: dict[str, int] = field(default_factory=dict)  # key id -> 질문 번호
    result: Optional[dict] = None
    touched: float = field(default_factory=time.time)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    busy: bool = False

    @property
    def max_questions(self) -> int:
        return int(self.case.get("max_questions", 20))

    @property
    def remaining(self) -> int:
        return max(0, self.max_questions - len(self.history))

    def find_repeat(self, question: str) -> Optional[Entry]:
        nq = normalize(question)
        for e in self.history:
            if normalize(e.question) == nq:
                return e
        return None

    def add(self, question: str, answer: str, keys: list[str]) -> tuple[Entry, list[str]]:
        entry = Entry(question=question, answer=answer, keys=[], n=len(self.history) + 1)
        new = [k for k in keys if k not in self.found]
        for k in new:
            self.found[k] = entry.n
        entry.keys = new
        self.history.append(entry)
        return entry, new

    def state(self) -> dict:
        return {
            "game_id": self.id,
            "case": public_view(self.case),
            "max_questions": self.max_questions,
            "remaining": self.remaining,
            "history": [e.to_dict() for e in self.history],
            "found_keys": sorted(self.found),
            "finished": self.result is not None,
            "result": self.result,
        }

    def finish(self, culprit_id: str, explanation: str, explained_keys: list[str]) -> dict:
        truth = self.case["truth"]
        culprit_ok = culprit_id == truth["culprit"]
        accomplice_ok = bool(truth.get("accomplice")) and culprit_id == truth["accomplice"]
        culprit_score = SCORE_CULPRIT if culprit_ok else SCORE_ACCOMPLICE if accomplice_ok else 0

        keys = []
        for k in truth["keys"]:
            if k["id"] in self.found:
                source, q = "question", self.found[k["id"]]
            elif k["id"] in explained_keys:
                source, q = "explanation", None
            else:
                source, q = None, None
            keys.append({"id": k["id"], "title": k["title"], "fact": k["fact"], "source": source, "question_n": q})
        solved = sum(1 for k in keys if k["source"])
        score = culprit_score + solved * SCORE_KEY
        rank, comment = next((r, c) for floor, r, c in RANKS if score >= floor)

        self.result = {
            "score": score,
            "rank": rank,
            "comment": comment,
            "accused": {"id": culprit_id, "name": person_name(self.case, culprit_id)},
            "culprit": {"id": truth["culprit"], "name": person_name(self.case, truth["culprit"])},
            "accomplice": (
                {"id": truth["accomplice"], "name": person_name(self.case, truth["accomplice"])}
                if truth.get("accomplice") else None
            ),
            "culprit_correct": culprit_ok,
            "accomplice_named": accomplice_ok,
            "culprit_score": culprit_score,
            "keys": keys,
            "solved_keys": solved,
            "questions_used": len(self.history),
            "explanation": explanation,
            "story": truth["story"],
            "epilogue": truth["epilogue"],
            "motif": self.case["motif"],
        }
        return self.result


class GameStore:
    def __init__(self):
        self._games: "OrderedDict[str, Game]" = OrderedDict()
        self._lock = threading.Lock()

    def create(self, case: dict) -> Game:
        with self._lock:
            self._purge()
            game = Game(id=secrets.token_urlsafe(12), case=case)
            self._games[game.id] = game
            return game

    def get(self, game_id: str) -> Optional[Game]:
        with self._lock:
            game = self._games.get(game_id)
            if game:
                game.touched = time.time()
                self._games.move_to_end(game_id)
            return game

    def _purge(self) -> None:
        now = time.time()
        for gid in [g for g, v in self._games.items() if now - v.touched > SESSION_TTL]:
            del self._games[gid]
        while len(self._games) >= MAX_SESSIONS:
            self._games.popitem(last=False)
