"""테스트 공통: 가짜 AI(판정·채점·생성·검토·모더레이션)와 임시 DB. 실제 OpenAI 호출 없음."""
import copy

import pytest
from fastapi.testclient import TestClient

from app import main, store
from app.llm import Judge, Judgement, get_judge
from app.main import app

GENERATED = {
    "blocked": False,
    "blocked_reason": "",
    "title": "등대지기의 마지막 밤",
    "era": "1983년 겨울",
    "place": "가상의 섬 은파도",
    "type": "실종",
    "difficulty": "보통",
    "teaser": "등대 불은 켜져 있었고, 등대지기는 없었다.",
    "question": "등대지기는 어디로 사라졌을까?",
    "accuse_label": "이 일을 꾸민 사람은 누구인가요?",
    "examples": ["등대지기는 살아 있나요?", "섬에 다른 배가 왔나요?", "일지는 등대지기가 썼나요?"],
    "briefing": ["1983년 12월, 은파도 등대지기 한만석이 사라졌다.", "등대 불은 밤새 켜져 있었다.", "섬에는 네 사람이 살았다."],
    "evidence": [
        {"title": "등대 일지", "body": "마지막 줄은 '바람이 잔다'."},
        {"title": "선착장 밧줄", "body": "새 밧줄이 하나 늘었다."},
        {"title": "빈 옷장", "body": "겨울 외투만 사라졌다."},
        {"title": "우체국 장부", "body": "편지 한 통이 육지로 갔다."},
        {"title": "발전기 기름", "body": "기름이 평소의 두 배로 줄었다."},
    ],
    "people": [
        {"name": "한만석", "age": 58, "role": "등대지기", "desc": "섬에서 20년을 살았다."},
        {"name": "오정례", "age": 52, "role": "우체국장", "desc": "섬의 모든 편지를 다룬다."},
        {"name": "김도윤", "age": 33, "role": "어부", "desc": "작은 배를 가지고 있다."},
        {"name": "박세희", "age": 27, "role": "교사", "desc": "올해 섬에 왔다."},
    ],
    "culprit": 0,
    "accomplice": 2,
    "story": ["한만석은 스스로 섬을 떠났다.", "김도윤의 배로 밤에 육지로 갔다.", "등대 불은 자동 타이머로 켜 두었다."],
    "epilogue": "그는 육지에서 딸과 함께 살았다.",
    "facts": [f"사실 {i}" for i in range(1, 15)],
    "keys": [
        {"title": "등대지기의 생사", "fact": "한만석은 살아 있다."},
        {"title": "떠난 방법", "fact": "김도윤의 배로 떠났다."},
        {"title": "꺼지지 않은 불", "fact": "타이머로 불을 켜 두었다."},
        {"title": "편지", "fact": "딸에게 미리 편지를 보냈다."},
        {"title": "떠난 이유", "fact": "딸과 살려고 떠났다."},
    ],
}


class FakeJudge(Judge):
    ready = True
    model = "fake"

    def __init__(self):
        self.calls = 0
        self.reviews = 0
        self.generations = 0

    def judge(self, case, question):
        self.calls += 1
        if "누구" in question:
            return Judgement("INVALID", "NOT_YES_NO")
        if "숙성실" in question:
            return Judgement("YES", keys=["K1"])
        if "돈이 목적" in question:
            return Judgement("NO", keys=["K3"])
        if "박상도" in question:
            return Judgement("YES")
        if "날씨" in question:
            return Judgement("IRRELEVANT")
        return Judgement("NO")

    def grade(self, case, explanation):
        return ["K4", "K5"] if "매각" in explanation else []

    def generate(self, brief):
        self.generations += 1
        data = copy.deepcopy(GENERATED)
        if "실존" in brief.get("idea", ""):
            data.update(blocked=True, blocked_reason="실존 인물이 들어 있어요.")
        return data

    def review(self, case):
        self.reviews += 1
        names = " ".join(p["name"] for p in case["people"])
        if "홍길동" in names:
            return {"blocked": True, "blocked_reason": "실존 인물 이름이 보여요.", "verdict": "플레이 불가", "issues": []}
        return {"blocked": False, "blocked_reason": "", "verdict": "보완 필요",
                "issues": [{"severity": "warn", "field": "facts", "message": "알리바이 사실을 더 적어 주세요."}]}

    def moderate(self, text):
        return ["sexual"] if "금지어" in text else []


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setenv("RECASE_DB", str(tmp_path / "test.db"))
    store._conn = None
    yield
    if store._conn is not None:
        store._conn.close()
        store._conn = None


@pytest.fixture()
def fake():
    judge = FakeJudge()
    main._calls.clear()
    main._answer_cache.clear()
    app.dependency_overrides[get_judge] = lambda: judge
    yield judge
    app.dependency_overrides.clear()


@pytest.fixture()
def client(fake):
    return TestClient(app)
