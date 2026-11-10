"""사건 제작실: AI 생성, 직접 작성, 검사, 수정 키, 공유, 안전장치."""
import copy
import json

from app import studio

MANUAL = {
    "title": "새벽 세 시의 피아노",
    "era": "2003년 가을",
    "place": "가상의 도시 해온시, 낡은 음악학원",
    "type": "도난",
    "difficulty": "쉬움",
    "teaser": "잠긴 학원에서 새벽마다 피아노 소리가 났다.",
    "question": "누가, 왜 밤마다 피아노를 쳤을까?",
    "accuse_label": "범인은 누구인가요?",
    "examples": ["피아노 소리는 사람이 낸 건가요?", "학원 열쇠가 더 있었나요?"],
    "briefing": "해온시의 낡은 음악학원.\n새벽 세 시마다 피아노 소리가 났다.\n그리고 금고의 악보 원본이 사라졌다.",
    "evidence": [
        {"title": "녹음테이프", "body": "같은 곡이 반복된다."},
        {"title": "창문 먼지", "body": "한 창문만 먼지가 없다."},
        {"title": "빈 금고", "body": "악보 원본만 없다."},
    ],
    "people": [
        {"id": "P1", "name": "서은재", "age": "41", "role": "원장", "desc": "학원을 20년째 운영."},
        {"id": "P2", "name": "문태오", "age": "", "role": "조율사", "desc": "매주 화요일에 온다."},
        {"id": "P3", "name": "이하린", "age": 19, "role": "수강생", "desc": "콩쿠르를 준비 중."},
    ],
    "truth": {
        "culprit": "P2",
        "accomplice": None,
        "story": "조율사 문태오가 악보 원본을 노렸다.\n피아노 소리는 경비를 다른 쪽으로 돌리려는 녹음이었다.",
        "epilogue": "악보는 경매에 나오지 않았다.",
        "facts": "\n".join(f"사실 {i}" for i in range(1, 13)),
        "keys": [
            {"title": "피아노 소리", "fact": "녹음된 소리였다."},
            {"title": "들어온 길", "fact": "먼지 없는 창문으로 들어왔다."},
            {"title": "노린 것", "fact": "악보 원본을 노렸다."},
            {"title": "열쇠", "fact": "조율사는 열쇠가 없었다."},
            {"title": "동기", "fact": "빚 때문이었다."},
        ],
    },
}


def no_truth(payload):
    text = json.dumps(payload, ensure_ascii=False)
    return '"truth"' not in text and "녹음된 소리였다" not in text and "한만석은 스스로" not in text


def test_generate_creates_playable_shared_case(client, fake):
    r = client.post("/api/studio/generate", json={"place": "외딴섬 등대", "mood": "쓸쓸한", "difficulty": "보통"})
    assert r.status_code == 200, r.text
    body = r.json()
    cid, key = body["case_id"], body["edit_key"]
    assert cid.startswith("u") and len(key) > 20 and no_truth(body)
    assert body["case"]["kind"] == "user" and "AI" in body["case"]["basis"]

    # 공유 링크로 들어온 사람도 사건 요약을 볼 수 있다 (진실 없이)
    summary = client.get(f"/api/cases/{cid}").json()
    assert summary["title"] == "등대지기의 마지막 밤" and no_truth(summary)

    # 플레이: 판정·채점 흐름이 기본 사건과 같다
    state = client.post("/api/games", json={"case_id": cid}).json()
    assert no_truth(state) and [k["title"] for k in state["case"]["keys"]][0] == "등대지기의 생사"
    assert [p["id"] for p in state["case"]["people"]] == ["P1", "P2", "P3", "P4"]
    gid = state["game_id"]
    assert client.post(f"/api/games/{gid}/questions", json={"question": "등대지기는 살아 있나요?"}).json()["status"] == "answered"
    result = client.post(f"/api/games/{gid}/accusation", json={"culprit_id": "P1", "explanation": ""}).json()
    assert result["culprit_correct"] and result["kind"] == "user"
    assert client.get(f"/api/cases/{cid}").json()["plays"] == 1


def test_generate_blocked_and_moderated(client, fake):
    r = client.post("/api/studio/generate", json={"idea": "실존 연예인이 범인"})
    assert r.status_code == 422 and "만들 수 없어요" in r.json()["detail"]
    r = client.post("/api/studio/generate", json={"idea": "금지어 포함"})
    assert r.status_code == 422 and fake.generations == 1  # 모더레이션에 걸리면 AI 생성까지 가지 않는다


def test_generate_retries_bad_format_once(client, fake, monkeypatch):
    calls = []

    def flaky(brief):
        calls.append(1)
        from tests.conftest import GENERATED
        data = copy.deepcopy(GENERATED)
        if len(calls) == 1:
            data["keys"] = data["keys"][:3]
        return data

    monkeypatch.setattr(fake, "generate", flaky)
    r = client.post("/api/studio/generate", json={})
    assert r.status_code == 200 and len(calls) == 2


def test_generate_rate_limit(client):
    for _ in range(6):
        assert client.post("/api/studio/generate", json={}).status_code == 200
    r = client.post("/api/studio/generate", json={})
    assert r.status_code == 429 and "6번" in r.json()["detail"]


def test_manual_case_save_edit_delete(client, fake):
    r = client.post("/api/studio/cases", json={"case": MANUAL})
    assert r.status_code == 200, r.text
    cid, key = r.json()["case_id"], r.json()["edit_key"]
    assert no_truth(r.json()) and "직접" in r.json()["case"]["basis"]

    # 수정 키가 있어야 진실까지 열람·수정할 수 있다
    assert client.get(f"/api/studio/cases/{cid}").status_code == 403
    assert client.get(f"/api/studio/cases/{cid}", headers={"X-Edit-Key": "wrong"}).status_code == 403
    full = client.get(f"/api/studio/cases/{cid}", headers={"X-Edit-Key": key}).json()["case"]
    assert full["truth"]["culprit"] == "P2" and full["truth"]["story"][1].startswith("피아노 소리는")
    assert full["people"][1].get("age") is None and full["people"][0]["age"] == 41

    edited = copy.deepcopy(full)
    edited["title"] = "새벽 세 시의 피아노 (수정판)"
    r = client.put(f"/api/studio/cases/{cid}", json={"case": edited}, headers={"X-Edit-Key": key})
    assert r.status_code == 200 and r.json()["case"]["title"].endswith("(수정판)")

    assert client.delete(f"/api/studio/cases/{cid}", headers={"X-Edit-Key": "wrong"}).status_code == 403
    assert client.delete(f"/api/studio/cases/{cid}", headers={"X-Edit-Key": key}).status_code == 200
    assert client.get(f"/api/cases/{cid}").status_code == 404


def test_review_reports_format_errors_without_ai(client, fake):
    broken = copy.deepcopy(MANUAL)
    broken["truth"]["keys"] = broken["truth"]["keys"][:2]
    broken["truth"]["culprit"] = None
    r = client.post("/api/studio/review", json={"case": broken}).json()
    fields = {i["field"] for i in r["issues"]}
    assert r["verdict"] == "플레이 불가" and {"keys", "culprit"} <= fields and fake.reviews == 0

    r = client.post("/api/studio/review", json={"case": MANUAL}).json()
    assert r["verdict"] == "보완 필요" and r["issues"][0]["field"] == "facts" and fake.reviews == 1

    # 저장할 때는 형식 오류를 422로 돌려준다
    r = client.post("/api/studio/cases", json={"case": broken})
    assert r.status_code == 422 and r.json()["issues"]


def test_manual_case_safety(client):
    real = copy.deepcopy(MANUAL)
    real["people"][0]["name"] = "홍길동"
    r = client.post("/api/studio/cases", json={"case": real})
    assert r.status_code == 422 and "실존" in r.json()["detail"]

    bad = copy.deepcopy(MANUAL)
    bad["teaser"] = "금지어"
    assert client.post("/api/studio/cases", json={"case": bad}).status_code == 422


def test_normalize_maps_people_and_trims():
    case = studio.normalize({**MANUAL, "title": "  공백   제목  " + "가" * 100})
    assert case["title"].startswith("공백 제목") and len(case["title"]) == 40
    assert case["truth"]["culprit"] == "P2" and case["truth"]["accomplice"] is None
    assert [e["id"] for e in case["evidence"]] == ["E1", "E2", "E3"]
    assert [k["id"] for k in case["truth"]["keys"]] == ["K1", "K2", "K3", "K4", "K5"]
    assert case["briefing"][1] == "새벽 세 시마다 피아노 소리가 났다."
