"""사건 데이터. 기본 사건(cases.json)과 사용자 사건(store)을 같은 모양으로 다룬다.
진실 원장(truth)은 서버 안에서만 쓰고, 공개용 데이터에서는 뺀다."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

from . import store

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "cases.json"

SUMMARY_FIELDS = ("id", "kind", "region", "solved", "number", "title", "era", "place", "type", "basis", "difficulty", "teaser")
PUBLIC_FIELDS = SUMMARY_FIELDS + ("question", "accuse_label", "examples", "briefing", "evidence", "people", "max_questions")


@lru_cache(maxsize=1)
def _load() -> dict:
    with DATA_PATH.open(encoding="utf-8") as f:
        cases = json.load(f)
    return {c["id"]: c for c in cases}


def all_cases() -> list[dict]:
    return list(_load().values())


def get_case(case_id: str) -> Optional[dict]:
    return _load().get(case_id) or store.get(case_id)


def summary(case: dict) -> dict:
    out = {k: case.get(k) for k in SUMMARY_FIELDS}
    if case.get("kind") == "user":
        out["plays"] = case.get("plays", 0)
    return out


def public_view(case: dict) -> dict:
    view = {k: case.get(k) for k in PUBLIC_FIELDS}
    view["examples"] = view.get("examples") or []
    # 핵심 사실은 '제목'만 공개한다 (내용은 추리 제출 뒤에 공개).
    view["keys"] = [{"id": k["id"], "title": k["title"]} for k in case["truth"]["keys"]]
    return view


def person_name(case: dict, person_id: Optional[str]) -> Optional[str]:
    for p in case["people"]:
        if p["id"] == person_id:
            return p["name"]
    return None
