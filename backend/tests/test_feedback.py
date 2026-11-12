"""후기 설문과 관리자 화면 API.

TiDB 저장소 테스트는 MySQL 호환 테스트 DB가 있을 때만 돈다.
예: RECASE_TEST_MYSQL="127.0.0.1:3307:사용자:비밀번호" pytest
"""
import csv
import io
import os

import pytest

from app import feedback
from app.main import app

PW = "test-admin-pw"


def answer(**over):
    data = {
        "name": "김민지",
        "freq": "가끔 즐긴다",
        "cases": ["bermuda", "zodiac"],
        "studio_used": "아니오",
        "ratings": {q: 4 for q in feedback.QIDS},
        "best": "도장이 찍히는 게 재밌었다.",
        "improve": "",
    }
    data.update(over)
    return data


@pytest.fixture()
def fb(fake, tmp_path, monkeypatch):
    store = feedback.LocalStore(str(tmp_path / "feedback.db"))
    app.dependency_overrides[feedback.get_store] = lambda: store
    monkeypatch.setenv("ADMIN_PASSWORD", PW)
    return store


def admin(client, pw=PW):
    return client.get("/api/admin/feedback", headers={"X-Admin-Password": pw})


def test_form_matches_google_form(client):
    f = client.get("/api/feedback/form").json()
    assert len(f["questions"]) == 13 and f["questions"][10]["required"] is False
    assert [c["id"] for c in f["cases"]][-1] == "studio" and len(f["cases"]) == 7
    assert f["scale"][0] == "전혀 그렇지 않다" and f["scale"][-1] == "매우 그렇다"


def test_submit_and_admin_summary(client, fb):
    assert client.post("/api/feedback", json=answer()).json()["ok"]
    r2 = answer(name="  박 서준  ", studio_used="예", cases=["studio", "bermuda"],
                ratings={**{q: 5 for q in feedback.QIDS}, "q12": 3})
    assert client.post("/api/feedback", json=r2).status_code == 200

    data = admin(client).json()
    assert data["store"] == "local" and data["summary"]["total"] == 2
    s = data["summary"]
    q11 = next(q for q in s["questions"] if q["id"] == "q11")
    assert q11["n"] == 1 and q11["avg"] == 5.0  # 제작실을 안 써 본 사람의 11번은 비워 둔다
    assert s["overall"] == 3.5 and s["recommend"] == 4.5
    assert {c["label"]: c["n"] for c in s["cases"]}["버뮤다 삼각지대"] == 2
    assert {c["label"]: c["n"] for c in s["studio_used"]} == {"예": 1, "아니오": 1}
    newest = data["responses"][0]
    assert newest["name"] == "박 서준" and newest["cases"] == ["버뮤다 삼각지대", "사건 제작실에서 만든 사건"]
    assert data["responses"][1]["q11"] is None and data["responses"][1]["avg"] == 4.0


def test_validation(client, fb):
    bad = [
        answer(name=""),
        answer(name="가" * 21),
        answer(freq="매일"),
        answer(cases=[]),
        answer(cases=["nope"]),
        answer(ratings={**{q: 4 for q in feedback.QIDS}, "q3": 6}),
        answer(ratings={q: 4 for q in feedback.QIDS if q != "q5"}),
        answer(best="가" * 501),
    ]
    for b in bad:
        r = client.post("/api/feedback", json=b)
        assert r.status_code == 422 and r.json()["issues"], b
    # 제작실을 써 봤다면 11번은 비워도 된다(선택 문항)
    ok = answer(studio_used="예", ratings={q: 3 for q in feedback.QIDS if q != "q11"})
    assert client.post("/api/feedback", json=ok).status_code == 200
    assert admin(client).json()["summary"]["total"] == 1


def test_admin_password(client, fb, monkeypatch):
    assert admin(client, "wrong").status_code == 401
    assert client.get("/api/admin/feedback").status_code == 401
    monkeypatch.delenv("ADMIN_PASSWORD")
    r = admin(client)
    assert r.status_code == 503 and "ADMIN_PASSWORD" in r.json()["detail"]


def test_admin_password_can_be_korean(client, fb, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "리케이스%관리")
    from urllib.parse import quote
    assert admin(client, quote("리케이스%관리")).status_code == 200


def test_admin_locks_after_failed_logins(client, fb):
    for _ in range(10):
        assert admin(client, "wrong").status_code == 401
    assert admin(client, "wrong").status_code == 429
    assert admin(client).status_code == 429  # 잠긴 동안에는 맞는 비밀번호도 막는다


def test_rate_limit_and_honeypot(client, fb):
    for i in range(5):
        assert client.post("/api/feedback", json=answer(name=f"사람{i}")).status_code == 200
    r = client.post("/api/feedback", json=answer(name="여섯째"))
    assert r.status_code == 429 and "5번" in r.json()["detail"]
    assert client.post("/api/feedback", json=answer(website="http://spam")).json()["ok"]
    assert admin(client).json()["summary"]["total"] == 5


def test_csv_blocks_spreadsheet_formulas(client, fb):
    client.post("/api/feedback", json=answer(name="=HYPERLINK(1)", improve="+사실은 좋았음"))
    r = client.get("/api/admin/feedback.csv", headers={"X-Admin-Password": PW})
    assert r.status_code == 200 and r.text.startswith("﻿")
    rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿"))))
    assert rows[0][0] == "제출 시각" and len(rows) == 2
    assert rows[1][1] == "'=HYPERLINK(1)" and rows[1][-1] == "'+사실은 좋았음"


def test_tidb_settings_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("RECASE_FEEDBACK_DB", str(tmp_path / "fb.db"))
    monkeypatch.setattr(feedback, "_local", None)
    for k in ("TIDB_HOST", "TIDB_PORT", "TIDB_USER", "TIDB_PASSWORD", "TIDB_DB_NAME", "CA_PATH"):
        monkeypatch.delenv(k, raising=False)
    assert feedback.TiDBStore.from_env() is None
    assert feedback.get_store().kind == "local"

    monkeypatch.setenv("TIDB_HOST", "gateway01.ap-northeast-1.prod.aws.tidbcloud.com")
    monkeypatch.setenv("TIDB_USER", "abc.root")
    with pytest.raises(feedback.FeedbackError) as e:
        feedback.TiDBStore.from_env()
    assert e.value.status == 503 and "TIDB_PASSWORD" in e.value.message

    monkeypatch.setenv("TIDB_PASSWORD", "pw")
    conf = feedback.TiDBStore.from_env().conf
    assert conf["port"] == 4000 and conf["database"] == "recase"
    assert conf["ssl"] is True and conf["ca_path"].endswith(".pem")  # 클라우드는 항상 암호화 접속
    assert feedback.get_store().kind == "tidb"

    monkeypatch.setenv("TIDB_DB_NAME", "re-case; DROP")
    with pytest.raises(feedback.FeedbackError):
        feedback.TiDBStore.from_env()
    monkeypatch.setenv("TIDB_DB_NAME", "recase")
    monkeypatch.setenv("TIDB_HOST", "127.0.0.1")
    assert feedback.TiDBStore.from_env().conf["ssl"] is False


def test_tidb_unreachable_gives_clear_error(client, fake, monkeypatch):
    monkeypatch.setenv("TIDB_HOST", "127.0.0.1")
    monkeypatch.setenv("TIDB_PORT", "1")  # 아무것도 없는 포트
    monkeypatch.setenv("TIDB_USER", "u")
    monkeypatch.setenv("TIDB_PASSWORD", "p")
    r = client.post("/api/feedback", json=answer())
    assert r.status_code == 502 and "TiDB" in r.json()["detail"]


MYSQL = os.getenv("RECASE_TEST_MYSQL")


@pytest.mark.skipif(not MYSQL, reason="MySQL 호환 테스트 DB가 없음")
def test_tidb_store_roundtrip(client, fake, monkeypatch):
    host, port, user, password = MYSQL.split(":", 3)
    db = "recase_test"
    for k, v in (("TIDB_HOST", host), ("TIDB_PORT", port), ("TIDB_USER", user),
                 ("TIDB_PASSWORD", password), ("TIDB_DB_NAME", db)):
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("ADMIN_PASSWORD", PW)
    store = feedback.TiDBStore.from_env()
    conn = store._connect(with_db=False)
    with conn.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS `{db}`")  # 처음부터: DB와 표를 스스로 만드는지 본다
    conn.close()
    feedback.TiDBStore._ready.clear()

    assert client.post("/api/feedback", json=answer(name="첫째")).status_code == 200
    assert client.post("/api/feedback", json=answer(name="둘째", studio_used="예", cases=["studio"],
                                                     best="따옴표 ' \" 와 이모지 🔍 도 저장")).status_code == 200
    data = admin(client).json()
    assert data["store"] == "tidb" and data["summary"]["total"] == 2
    newest = data["responses"][0]
    assert newest["name"] == "둘째" and newest["cases"] == ["사건 제작실에서 만든 사건"]
    assert newest["best"] == "따옴표 ' \" 와 이모지 🔍 도 저장" and newest["q11"] == 4
    assert data["responses"][1]["q11"] is None and len(newest["submitted_at"]) == 19
    csv_text = client.get("/api/admin/feedback.csv", headers={"X-Admin-Password": PW}).text
    assert "첫째" in csv_text and "둘째" in csv_text
