"""후기 설문: 문항, 입력 검사, 저장소(TiDB Cloud 또는 로컬 SQLite), 관리자용 통계와 CSV.

무료 Render 서버는 잠들 때 디스크가 지워진다. 그래서 배포 환경에서는 TIDB_HOST 등 환경변수를 설정해
답변을 TiDB Cloud(MySQL 호환 클라우드 DB)에 쌓는다. 설정이 없으면 로컬 SQLite에 저장한다(개발용).
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from . import cases

log = logging.getLogger("recase.feedback")

KST = timezone(timedelta(hours=9))

# 구글 폼 설문과 같은 문항 (번호, 문항, 필수 여부)
QUESTIONS = [
    ("q1", "게임 방법(질문 20개, 예/아니오/관계없음 판정)을 바로 이해할 수 있었다.", True),
    ("q2", "화면 구성과 버튼이 사용하기 편했다.", True),
    ("q3", "AI 판정관의 답이 내 질문에 맞게 나왔다.", True),
    ("q4", "질문을 입력한 뒤 판정이 기다리기 힘들지 않을 만큼 빠르게 나왔다.", True),
    ("q5", "판정관이 정답을 미리 알려 주지 않아서 끝까지 추리하는 재미가 있었다.", True),
    ("q6", "질문으로 단서를 하나씩 모아 가는 과정이 재미있었다.", True),
    ("q7", "실제 사건을 바탕으로 한 사건 구성이 흥미로웠다.", True),
    ("q8", "사건을 시작하기 전에 실제 기록과 허구를 구분해 알려 준 것이 이해에 도움이 됐다.", True),
    ("q9", "증거 보드, 진술 조서 같은 화면 분위기 덕분에 형사가 된 느낌이 들었다.", True),
    ("q10", "채점 결과와 수사 결과 보고서가 납득할 만했다.", True),
    ("q11", "사건 제작실로 사건을 만들고 링크로 공유하기 쉬웠다.", False),
    ("q12", "전반적으로 RE:CASE에 만족한다.", True),
    ("q13", "다른 사람에게 RE:CASE를 추천하고 싶다.", True),
]
QIDS = [q[0] for q in QUESTIONS]
STUDIO_Q = "q11"  # 사건 제작실을 써 본 사람만 답한다
FREQ = ["자주 즐긴다", "가끔 즐긴다", "거의 안 즐긴다"]
YES_NO = ["예", "아니오"]
STUDIO_CASE = ("studio", "사건 제작실에서 만든 사건")
SCALE = ["전혀 그렇지 않다", "그렇지 않다", "보통이다", "그렇다", "매우 그렇다"]
MAX_TEXT = 500
# 저장하는 칸의 순서. 설문은 익명이라 이름 칸이 없다.
FIELDS = ["id", "submitted_at", "freq", "cases", "studio_used", *QIDS, "best", "improve"]


class FeedbackError(Exception):
    def __init__(self, status: int, message: str, issues: Optional[list] = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.issues = issues or []


def case_choices() -> list[dict]:
    built_in = [{"id": c["id"], "title": c["title"]} for c in cases.all_cases()]
    return built_in + [{"id": STUDIO_CASE[0], "title": STUDIO_CASE[1]}]


def form() -> dict:
    """화면이 그릴 설문 정의. 문항은 서버 한 곳에서만 관리한다."""
    return {
        "questions": [{"id": i, "text": t, "required": r} for i, t, r in QUESTIONS],
        "studio_question": STUDIO_Q,
        "freq": FREQ,
        "yes_no": YES_NO,
        "cases": case_choices(),
        "scale": SCALE,
        "max_text": MAX_TEXT,
    }


def validate(data: dict) -> dict:
    """제출된 설문을 검사해 저장할 한 줄(record)로 만든다. 문제가 있으면 FeedbackError(422)."""
    issues = []
    freq = data.get("freq")
    if freq not in FREQ:
        issues.append({"field": "freq", "message": "추리물을 얼마나 즐기는지 골라 주세요."})

    titles = {c["id"]: c["title"] for c in case_choices()}
    picked = data.get("cases") or []
    if not isinstance(picked, list) or not picked:
        issues.append({"field": "cases", "message": "플레이한 사건을 하나 이상 골라 주세요."})
        picked = []
    elif any(p not in titles for p in picked):
        issues.append({"field": "cases", "message": "목록에 없는 사건이 있어요."})

    studio_used = data.get("studio_used")
    if studio_used not in YES_NO:
        issues.append({"field": "studio_used", "message": "사건 제작실을 써 봤는지 골라 주세요."})

    ratings = data.get("ratings") or {}
    if not isinstance(ratings, dict):
        ratings = {}
    scores: dict[str, Optional[int]] = {}
    for qid, _, required in QUESTIONS:
        v = ratings.get(qid)
        if qid == STUDIO_Q and studio_used != "예":
            scores[qid] = None
            continue
        if v in (None, ""):
            if required:
                issues.append({"field": qid, "message": f"{QIDS.index(qid) + 1}번 문항에 답해 주세요."})
            scores[qid] = None
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or not 1 <= v <= 5:
            issues.append({"field": qid, "message": f"{QIDS.index(qid) + 1}번 문항은 1~5점으로 골라 주세요."})
            scores[qid] = None
            continue
        scores[qid] = int(v)

    texts = {}
    for f in ("best", "improve"):
        t = str(data.get(f) or "").strip()
        if len(t) > MAX_TEXT:
            issues.append({"field": f, "message": f"의견은 {MAX_TEXT}자 안으로 적어 주세요."})
        texts[f] = t[:MAX_TEXT]

    if issues:
        raise FeedbackError(422, "설문에 빠진 곳이 있어요.", issues)

    order = [c["id"] for c in case_choices()]
    return {
        "id": secrets.token_hex(5),
        "submitted_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S"),
        "freq": freq,
        "cases": [titles[p] for p in sorted(set(picked), key=order.index)],
        "studio_used": studio_used,
        **scores,
        **texts,
    }


def _from_row(row: dict) -> dict:
    """저장소에서 읽은 한 줄을 화면에 넘길 모양으로 맞춘다."""
    out = {f: row.get(f) for f in FIELDS}
    c = out.get("cases")
    if isinstance(c, str) and c.startswith("["):
        try:
            c = json.loads(c)
        except ValueError:
            c = []
    if isinstance(c, str):
        out["cases"] = [x.strip() for x in c.split(",") if x.strip()]
    elif isinstance(c, list):
        out["cases"] = [str(x) for x in c]
    elif not isinstance(c, list):
        out["cases"] = []
    for q in QIDS:
        v = out.get(q)
        try:
            out[q] = int(v) if v not in (None, "") and 1 <= int(float(v)) <= 5 else None
        except (TypeError, ValueError):
            out[q] = None
    if isinstance(out.get("submitted_at"), datetime):
        out["submitted_at"] = out["submitted_at"].strftime("%Y-%m-%d %H:%M:%S")
    for f in ("id", "submitted_at", "freq", "studio_used", "best", "improve"):
        out[f] = "" if out.get(f) is None else str(out[f])
    return out


# ---------------- 저장소 ----------------
class LocalStore:
    """개발용 · 임시 저장. Render 무료 서버에서는 서버가 잠들면 지워진다."""

    kind = "local"

    def __init__(self, path: Optional[str] = None):
        self.path = path or os.getenv("RECASE_FEEDBACK_DB") or str(Path(__file__).resolve().parent.parent / "data" / "feedback.db")
        self._lock = threading.Lock()
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as db:
            db.execute("CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)")

    def _conn(self):
        return sqlite3.connect(self.path)

    def add(self, record: dict) -> None:
        with self._lock, self._conn() as db:
            db.execute("INSERT INTO feedback VALUES (?, ?, ?)",
                       (record["id"], json.dumps(record, ensure_ascii=False), record["submitted_at"]))

    def list(self) -> list[dict]:
        with self._lock, self._conn() as db:
            rows = db.execute("SELECT data FROM feedback ORDER BY rowid").fetchall()
        return [_from_row(json.loads(r[0])) for r in rows]


_IDENT = re.compile(r"^[A-Za-z0-9_]{1,64}$")
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


class TiDBStore:
    """TiDB Cloud(MySQL 호환)에 저장한다. Render 서버가 잠들거나 다시 배포돼도 답변이 남는다.

    접속 정보는 TiDB Cloud의 Connect 창에 나오는 값을 Render 환경변수로 넣는다.
    TIDB_HOST, TIDB_PORT(기본 4000), TIDB_USER, TIDB_PASSWORD, TIDB_DB_NAME(기본 recase), CA_PATH(선택)
    """

    kind = "tidb"
    _ready: set = set()  # 테이블을 이미 만든 (호스트, 포트, DB)
    _ready_lock = threading.Lock()

    def __init__(self, conf: dict):
        self.conf = conf

    @classmethod
    def from_env(cls) -> Optional["TiDBStore"]:
        host = os.getenv("TIDB_HOST", "").strip()
        if not host:
            return None
        user = os.getenv("TIDB_USER", "").strip()
        password = os.getenv("TIDB_PASSWORD", "")
        database = os.getenv("TIDB_DB_NAME", "").strip() or "recase"
        missing = [k for k, v in (("TIDB_USER", user), ("TIDB_PASSWORD", password)) if not v]
        if missing:
            raise FeedbackError(503, f"TiDB 설정이 덜 됐어요. Render 환경변수에 {', '.join(missing)}를 넣어 주세요.")
        if not _IDENT.match(database):
            raise FeedbackError(503, "TIDB_DB_NAME은 영문, 숫자, 밑줄(_)로만 적어 주세요.")
        try:
            port = int(os.getenv("TIDB_PORT", "").strip() or 4000)
        except ValueError:
            raise FeedbackError(503, "TIDB_PORT는 숫자여야 해요. (보통 4000)")
        # TiDB Cloud는 암호화(TLS) 접속만 받는다. 내 컴퓨터의 테스트 DB만 예외.
        ssl = host not in _LOCAL_HOSTS
        ca_path = os.getenv("CA_PATH", "").strip() or None
        if ssl and not ca_path:
            import certifi
            ca_path = certifi.where()
        return cls({"host": host, "port": port, "user": user, "password": password,
                    "database": database, "ssl": ssl, "ca_path": ca_path})

    def _connect(self, with_db: bool = True):
        import pymysql
        c = self.conf
        kw = dict(host=c["host"], port=c["port"], user=c["user"], password=c["password"], charset="utf8mb4",
                  connect_timeout=10, read_timeout=20, write_timeout=20, autocommit=True,
                  cursorclass=pymysql.cursors.DictCursor)
        if with_db:
            kw["database"] = c["database"]
        if c["ssl"]:
            kw.update(ssl_ca=c["ca_path"], ssl_verify_cert=True, ssl_verify_identity=True)
        try:
            return pymysql.connect(**kw)
        except pymysql.MySQLError as e:
            code = e.args[0] if e.args else None
            log.warning("TiDB 접속 실패 (%s): %s", code, e)
            if code == 1045:
                raise FeedbackError(502, "TiDB 사용자 이름이나 비밀번호가 맞지 않아요. Render의 TIDB_USER, TIDB_PASSWORD를 확인해 주세요.") from e
            raise FeedbackError(502, "설문 저장소(TiDB)에 연결하지 못했어요. 잠시 뒤에 다시 시도해 주세요.") from e

    def _ensure_table(self) -> None:
        c = self.conf
        key = (c["host"], c["port"], c["database"])
        if key in self._ready:
            return
        with self._ready_lock:
            if key in self._ready:
                return
            import pymysql
            conn = self._connect(with_db=False)
            try:
                with conn.cursor() as cur:
                    try:
                        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{c['database']}`")
                    except pymysql.MySQLError as e:  # DB를 만들 권한이 없어도 이미 있으면 그대로 쓴다
                        log.info("CREATE DATABASE 건너뜀: %s", e)
                    cur.execute(f"USE `{c['database']}`")
                    ratings = ",\n".join(f"  {q} TINYINT NULL" for q in QIDS)
                    cur.execute(f"""CREATE TABLE IF NOT EXISTS feedback (
  id VARCHAR(16) NOT NULL PRIMARY KEY,
  submitted_at DATETIME NOT NULL,
  name VARCHAR(40) NOT NULL DEFAULT '' COMMENT '예전 버전 호환용. 익명 설문이라 비워 둔다',
  freq VARCHAR(20) NOT NULL,
  cases TEXT NOT NULL,
  studio_used VARCHAR(8) NOT NULL,
{ratings},
  best TEXT NOT NULL,
  improve TEXT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_created (created_at)
) DEFAULT CHARSET=utf8mb4 COMMENT='RE:CASE 사이트 후기 설문'""")
            except pymysql.MySQLError as e:
                log.warning("TiDB 표 준비 실패: %s", e)
                raise FeedbackError(502, f"TiDB에 설문 표를 만들지 못했어요. TIDB_DB_NAME({c['database']})과 계정 권한을 확인해 주세요.") from e
            finally:
                conn.close()
            self._ready.add(key)

    def _run(self, sql: str, args=None) -> list:
        import pymysql
        self._ensure_table()
        conn = self._connect()
        try:
            with conn.cursor() as cur:
                cur.execute(sql, args)
                return cur.fetchall()
        except pymysql.MySQLError as e:
            log.warning("TiDB 쿼리 실패: %s", e)
            raise FeedbackError(502, "설문 저장소(TiDB)에서 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.") from e
        finally:
            conn.close()

    def add(self, record: dict) -> None:
        # name은 이름 칸이 있던 첫 버전으로 이미 만든 표와 맞추려고 빈 값으로 넣는다
        cols = [*FIELDS, "name", "created_at"]
        values = {**record, "name": "", "cases": json.dumps(record["cases"], ensure_ascii=False),
                  "created_at": datetime.now(KST).replace(tzinfo=None)}
        self._run(f"INSERT INTO feedback ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
                  [values[c] for c in cols])

    def list(self) -> list[dict]:
        rows = self._run(f"SELECT {', '.join(FIELDS)} FROM feedback ORDER BY created_at, submitted_at")
        return [_from_row(r) for r in rows]


_local: Optional[LocalStore] = None
_local_lock = threading.Lock()


def get_store():
    """FastAPI 의존성. TiDB 설정이 있으면 TiDB, 없으면 로컬 SQLite(개발용)."""
    tidb = TiDBStore.from_env()
    if tidb:
        return tidb
    global _local
    with _local_lock:
        if _local is None:
            _local = LocalStore()
        return _local


# ---------------- 관리자용 정리 ----------------
def _avg(values: list[int]) -> Optional[float]:
    return round(sum(values) / len(values), 2) if values else None


def summarize(rows: list[dict]) -> dict:
    per_q = []
    for qid, text, required in QUESTIONS:
        vals = [r[qid] for r in rows if r.get(qid)]
        per_q.append({"id": qid, "text": text, "required": required, "n": len(vals), "avg": _avg(vals),
                      "dist": [vals.count(s) for s in range(1, 6)]})

    def count(field, choices):
        return [{"label": c, "n": sum(1 for r in rows if r.get(field) == c)} for c in choices]

    case_titles = [c["title"] for c in case_choices()]
    times = sorted(r["submitted_at"] for r in rows if r.get("submitted_at"))
    avgs = [a["avg"] for a in per_q if a["avg"] is not None]
    return {
        "total": len(rows),
        "scale": SCALE,
        "first": times[0] if times else None,
        "last": times[-1] if times else None,
        "overall": next(a["avg"] for a in per_q if a["id"] == "q12"),
        "recommend": next(a["avg"] for a in per_q if a["id"] == "q13"),
        "mean_of_questions": round(sum(avgs) / len(avgs), 2) if avgs else None,
        "questions": per_q,
        "freq": count("freq", FREQ),
        "studio_used": count("studio_used", YES_NO),
        "cases": [{"label": t, "n": sum(1 for r in rows if t in r.get("cases", []))} for t in case_titles],
    }


def response_avg(row: dict) -> Optional[float]:
    return _avg([row[q] for q in QIDS if row.get(q)])


def _cell(v) -> str:
    """스프레드시트가 수식으로 읽지 않도록 =, +, -, @ 로 시작하는 글자는 앞에 '를 붙인다."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["번호", "제출 시각", "추리물 즐김", "플레이한 사건", "사건 제작실 사용",
                *[f"{i + 1}. {t}" for i, (_, t, _) in enumerate(QUESTIONS)], "평균", "좋았던 점", "고칠 점"])
    for no, r in enumerate(rows, 1):
        w.writerow([no, _cell(r["submitted_at"]), _cell(r["freq"]), _cell(", ".join(r["cases"])),
                    _cell(r["studio_used"]), *["" if r[q] is None else r[q] for q in QIDS],
                    response_avg(r) or "", _cell(r["best"]), _cell(r["improve"])])
    return "﻿" + buf.getvalue()  # 엑셀에서 한글이 깨지지 않게 BOM을 붙인다
