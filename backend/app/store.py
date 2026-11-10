"""사용자가 만든 사건 저장소 (SQLite). 수정 키는 해시로만 저장한다."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "user_cases.db"
ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # 헷갈리는 글자(0,o,1,l,i) 제외

_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None
_path: Optional[str] = None


def _db() -> sqlite3.Connection:
    global _conn, _path
    path = os.getenv("RECASE_DB") or str(DEFAULT_DB)
    if _conn is None or _path != path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(path, check_same_thread=False)
        _conn.execute("""CREATE TABLE IF NOT EXISTS user_cases (
            id TEXT PRIMARY KEY,
            key_hash TEXT NOT NULL,
            source TEXT NOT NULL,
            title TEXT NOT NULL,
            data TEXT NOT NULL,
            plays INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL)""")
        _conn.commit()
        _path = path
    return _conn


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def new_id() -> str:
    return "u" + "".join(secrets.choice(ALPHABET) for _ in range(7))


def _decorate(case_id: str, source: str, case: dict, plays: int = 0) -> dict:
    label = "AI가 만든 가상 사건" if source == "ai" else "직접 만든 가상 사건"
    return {**case, "id": case_id, "kind": "user", "source": source, "number": case_id.upper(),
            "basis": f"사용자 사건 · {label}", "plays": plays}


def create(case: dict, source: str) -> tuple[str, str]:
    key = secrets.token_urlsafe(18)
    now = time.time()
    with _lock:
        db = _db()
        while True:
            case_id = new_id()
            if not db.execute("SELECT 1 FROM user_cases WHERE id=?", (case_id,)).fetchone():
                break
        db.execute("INSERT INTO user_cases VALUES (?,?,?,?,?,0,?,?)",
                   (case_id, _hash(key), source, case["title"], json.dumps(case, ensure_ascii=False), now, now))
        db.commit()
    return case_id, key


def get(case_id: str) -> Optional[dict]:
    if not case_id or not case_id.startswith("u"):
        return None
    with _lock:
        row = _db().execute("SELECT source, data, plays FROM user_cases WHERE id=?", (case_id,)).fetchone()
    if not row:
        return None
    return _decorate(case_id, row[0], json.loads(row[1]), row[2])


def check_key(case_id: str, key: Optional[str]) -> bool:
    with _lock:
        row = _db().execute("SELECT key_hash FROM user_cases WHERE id=?", (case_id,)).fetchone()
    return bool(row and key and hmac.compare_digest(row[0], _hash(key)))


def update(case_id: str, case: dict) -> None:
    with _lock:
        db = _db()
        db.execute("UPDATE user_cases SET data=?, title=?, updated_at=? WHERE id=?",
                   (json.dumps(case, ensure_ascii=False), case["title"], time.time(), case_id))
        db.commit()


def delete(case_id: str) -> None:
    with _lock:
        db = _db()
        db.execute("DELETE FROM user_cases WHERE id=?", (case_id,))
        db.commit()


def count_play(case_id: str) -> None:
    with _lock:
        db = _db()
        db.execute("UPDATE user_cases SET plays = plays + 1 WHERE id=?", (case_id,))
        db.commit()
