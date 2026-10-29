"""가짜 판정관으로 API 흐름을 검증한다. (실제 OpenAI 호출 없음)"""
import json

import httpx
import openai
import pytest
from fastapi.testclient import TestClient

from app import cases
from app.llm import Judge, Judgement, LLMError, OpenAIJudge, get_judge
from app import main
from app.main import app


class FakeJudge(Judge):
    ready = True
    model = "fake"

    def __init__(self):
        self.calls = 0

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


def truth_strings():
    out = []
    for c in cases.all_cases():
        t = c["truth"]
        out += t["story"] + t["facts"] + [k["fact"] for k in t["keys"]] + [t["epilogue"]]
    return out


def assert_no_truth(payload):
    text = json.dumps(payload, ensure_ascii=False)
    for s in truth_strings():
        assert s not in text, f"진실 유출: {s[:30]}"
    assert '"truth"' not in text and '"culprit"' not in text


def test_case_data_is_consistent():
    for c in cases.all_cases():
        ids = {p["id"] for p in c["people"]}
        t = c["truth"]
        assert t["culprit"] in ids
        assert t["accomplice"] in ids | {None}
        assert [k["id"] for k in t["keys"]] == ["K1", "K2", "K3", "K4", "K5"]
        assert c["max_questions"] == 20


def test_cases_list_hides_truth(client):
    res = client.get("/api/cases")
    assert res.status_code == 200
    assert len(res.json()) == 3
    assert_no_truth(res.json())


def test_full_game_flow(client, fake):
    state = client.post("/api/games", json={"case_id": "c1991"}).json()
    assert_no_truth(state)
    gid = state["game_id"]
    assert state["remaining"] == 20 and state["case"]["keys"][0] == {"id": "K1", "title": "감금 장소"}

    r = client.post(f"/api/games/{gid}/questions", json={"question": "재현은 숙성실에 갇혀 있었나요?"}).json()
    assert r["status"] == "answered" and r["label"] == "예" and r["new_keys"] == ["K1"] and r["remaining"] == 19
    assert_no_truth(r)

    # 같은 질문은 다시 세지 않고 판정관도 다시 부르지 않는다
    calls = fake.calls
    r = client.post(f"/api/games/{gid}/questions", json={"question": "  재현은 숙성실에 갇혀 있었나요 ? "}).json()
    assert r["status"] == "repeat" and r["remaining"] == 19 and fake.calls == calls

    # 예/아니오로 답할 수 없는 질문은 세지 않는다
    r = client.post(f"/api/games/{gid}/questions", json={"question": "범인은 누구야?"}).json()
    assert r["status"] == "invalid" and r["remaining"] == 19

    r = client.post(f"/api/games/{gid}/questions", json={"question": "범인은 돈이 목적이었나요?"}).json()
    assert r["label"] == "아니오" and r["new_keys"] == ["K3"]
    r = client.post(f"/api/games/{gid}/questions", json={"question": "그날 날씨가 중요한가요?"}).json()
    assert r["label"] == "관계없음" and r["remaining"] == 17

    state = client.get(f"/api/games/{gid}").json()
    assert len(state["history"]) == 3 and state["found_keys"] == ["K1", "K3"] and not state["finished"]
    assert_no_truth(state)

    result = client.post(f"/api/games/{gid}/accusation",
                         json={"culprit_id": "P3", "explanation": "매각을 막으려고 그랬고, 결렬되자 풀어줬다."}).json()
    assert result["culprit_correct"] and result["solved_keys"] == 4
    assert result["score"] == 40 + 4 * 12 and result["rank"] == "명탐정"
    sources = {k["id"]: k["source"] for k in result["keys"]}
    assert sources == {"K1": "question", "K2": None, "K3": "question", "K4": "explanation", "K5": "explanation"}

    # 제출 뒤에는 더 물을 수 없고, 결과는 다시 받아볼 수 있다
    assert client.post(f"/api/games/{gid}/questions", json={"question": "박상도인가요?"}).status_code == 409
    assert client.get(f"/api/games/{gid}").json()["result"]["score"] == 88


def test_question_budget(client):
    gid = client.post("/api/games", json={"case_id": "c1998"}).json()["game_id"]
    for i in range(20):
        r = client.post(f"/api/games/{gid}/questions", json={"question": f"질문 {i}번인가요?"})
        assert r.status_code == 200
    assert r.json()["remaining"] == 0
    r = client.post(f"/api/games/{gid}/questions", json={"question": "하나 더 되나요?"})
    assert r.status_code == 409


def test_accomplice_gets_partial_credit(client):
    gid = client.post("/api/games", json={"case_id": "c2001"}).json()["game_id"]
    result = client.post(f"/api/games/{gid}/accusation", json={"culprit_id": "P3", "explanation": ""}).json()
    assert not result["culprit_correct"] and result["accomplice_named"] and result["score"] == 20
    assert result["culprit"]["name"] == "서명준"


def test_validation(client):
    assert client.post("/api/games", json={"case_id": "nope"}).status_code == 404
    assert client.get("/api/games/nope").status_code == 404
    gid = client.post("/api/games", json={"case_id": "c1991"}).json()["game_id"]
    assert client.post(f"/api/games/{gid}/questions", json={"question": "   "}).status_code == 422
    assert client.post(f"/api/games/{gid}/questions", json={"question": "가" * 151}).status_code == 422
    assert client.post(f"/api/games/{gid}/accusation", json={"culprit_id": "P9"}).status_code == 422


def test_missing_api_key_is_friendly():
    judge = OpenAIJudge(api_key="")
    app.dependency_overrides[get_judge] = lambda: judge
    try:
        c = TestClient(app)
        assert c.get("/api/health").json()["ai_ready"] is False
        gid = c.post("/api/games", json={"case_id": "c1991"}).json()["game_id"]
        r = c.post(f"/api/games/{gid}/questions", json={"question": "아무 질문이나 해도 되나요?"})
        assert r.status_code == 503 and "OPENAI_API_KEY" in r.json()["detail"]
        assert c.get(f"/api/games/{gid}").json()["remaining"] == 20  # 실패한 질문은 세지 않는다
    finally:
        app.dependency_overrides.clear()


# ---------------- OpenAI 호출부 (가짜 클라이언트) ----------------
def _err(cls, status, param=None, message="error"):
    req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    return cls(message, response=httpx.Response(status, request=req), body={"param": param, "message": message})


class _Msg:
    def __init__(self, content):
        self.choices = [type("C", (), {"message": type("M", (), {"content": content})()})()]


class FakeClient:
    def __init__(self, script):
        self.script = script
        self.sent = []
        self.chat = type("Chat", (), {"completions": self})()

    def create(self, **params):
        self.sent.append(params)
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return _Msg(step)


def test_openai_drops_unsupported_param_and_falls_back_model():
    ok = json.dumps({"basis": "사실 5", "verdict": "YES", "invalid_reason": "NONE", "keys": ["K1", "K9"]})
    judge = OpenAIJudge(api_key="sk-test", model="my-model")
    judge._client = FakeClient([
        _err(openai.NotFoundError, 404, message="The model `my-model` does not exist"),
        _err(openai.BadRequestError, 400, param="reasoning_effort", message="Unsupported parameter: 'reasoning_effort'"),
        ok,
    ])
    case = cases.get_case("c1991")
    j = judge.judge(case, "숙성실인가요?")
    assert j.verdict == "YES" and j.keys == ["K1"]  # 없는 키 ID는 버린다
    assert judge.model == "gpt-5-mini"
    sent = judge._client.sent
    assert sent[0]["model"] == "my-model" and "temperature" in sent[0]
    assert "reasoning_effort" in sent[1] and "reasoning_effort" not in sent[2]
    assert sent[2]["response_format"]["type"] == "json_schema"


def test_openai_bad_key_message():
    judge = OpenAIJudge(api_key="sk-bad")
    judge._client = FakeClient([_err(openai.AuthenticationError, 401, message="Incorrect API key")])
    with pytest.raises(LLMError) as e:
        judge.judge(cases.get_case("c1991"), "질문인가요?")
    assert e.value.status == 502 and "키가 올바르지" in e.value.message
