"""Tests for favai conversation history."""

from __future__ import annotations

import json
import re
import sqlite3

import pytest

from favai.history import (
    HistoryError,
    archive_session,
    create_session,
    get_session,
    history_path,
    list_sessions,
    mark_confirmed,
    rename_session,
    save_session,
)


def _message(text: str = "hello") -> dict:
    return {"role": "user", "content": text, "timestamp": 1_700_000_000_000}


def test_create_and_list_session(tmp_path):
    session = create_session(
        tmp_path,
        title="A conversation",
        model_provider="openai",
        model_api="openai",
        model_name="m",
    )

    assert session["title"] == "A conversation"
    assert session["messages"] == []
    assert session["confirmed_transactions"] == []
    assert session["revision"] == 0
    assert session["model_provider"] == "openai"
    assert history_path(tmp_path).exists()

    result = list_sessions(tmp_path)
    assert [item["id"] for item in result["sessions"]] == [session["id"]]
    assert result["has_more"] is False


def test_create_session_uses_datetime_title_by_default(tmp_path):
    session = create_session(tmp_path)

    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", session["title"])


def test_schema_v1_migrates_model_provider(tmp_path):
    database = history_path(tmp_path)
    tmp_path.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
                revision INTEGER NOT NULL DEFAULT 0, model_api TEXT NOT NULL DEFAULT '',
                model_name TEXT NOT NULL DEFAULT '', messages_json TEXT NOT NULL DEFAULT '[]',
                proposal_json TEXT, proposal_dirty INTEGER NOT NULL DEFAULT 0,
                pending_proposal_json TEXT, confirmed_at TEXT, confirmed_count INTEGER
            )
            """
        )
        connection.execute("PRAGMA user_version = 1")

    create_session(tmp_path, model_provider="deepseek")

    with sqlite3.connect(database) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}
        version = connection.execute("PRAGMA user_version").fetchone()[0]
    assert "model_provider" in columns
    assert "confirmed_transactions_json" in columns
    assert version == 3


def test_schema_v2_moves_confirmed_proposal_to_written_history(tmp_path):
    database = history_path(tmp_path)
    tmp_path.mkdir(parents=True, exist_ok=True)
    proposal = [{"date": "2026-08-01", "postings": []}]
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
                revision INTEGER NOT NULL DEFAULT 0,
                model_provider TEXT NOT NULL DEFAULT '',
                model_api TEXT NOT NULL DEFAULT '', model_name TEXT NOT NULL DEFAULT '',
                messages_json TEXT NOT NULL DEFAULT '[]', proposal_json TEXT,
                proposal_dirty INTEGER NOT NULL DEFAULT 0,
                pending_proposal_json TEXT, confirmed_at TEXT, confirmed_count INTEGER
            )
            """
        )
        connection.execute(
            """
            INSERT INTO sessions (
                id, title, created_at, updated_at, proposal_json,
                confirmed_at, confirmed_count
            ) VALUES ('confirmed', 'Confirmed', 'now', 'now', ?, 'now', 1)
            """,
            (json.dumps(proposal),),
        )
        connection.execute("PRAGMA user_version = 2")

    migrated = get_session(tmp_path, "confirmed")

    assert migrated["proposal"] is None
    assert migrated["confirmed_transactions"] == proposal


def test_save_roundtrip_and_revision(tmp_path):
    session = create_session(tmp_path)
    proposal = [{"date": "2026-08-01", "postings": []}]

    saved = save_session(
        tmp_path,
        session["id"],
        expected_revision=0,
        messages=[_message()],
        proposal=proposal,
        proposal_dirty=True,
        title="hello",
    )

    assert saved["messages"] == [_message()]
    assert saved["proposal"] == proposal
    assert saved["proposal_dirty"] == 1
    assert saved["title"] == "hello"
    assert saved["revision"] == 1

    with pytest.raises(HistoryError, match="其他窗口"):
        save_session(
            tmp_path,
            session["id"],
            expected_revision=0,
            messages=[_message("stale")],
        )


@pytest.mark.parametrize(
    "messages",
    [
        {},
        [{"role": "unknown", "timestamp": 1}],
        [{"role": "user", "content": "x"}],
    ],
)
def test_rejects_invalid_messages(tmp_path, messages):
    session = create_session(tmp_path)
    with pytest.raises(HistoryError):
        save_session(
            tmp_path,
            session["id"],
            expected_revision=0,
            messages=messages,
        )


def test_rename_confirm_and_archive(tmp_path):
    session = create_session(tmp_path)
    renamed = rename_session(tmp_path, session["id"], "Renamed")
    assert renamed["title"] == "Renamed"

    saved = save_session(
        tmp_path,
        session["id"],
        expected_revision=renamed["revision"],
        messages=[_message()],
        proposal=[{"date": "2026-08-01", "postings": []}],
        proposal_dirty=True,
        pending_proposal=[{"date": "2026-08-02", "postings": []}],
    )

    first = saved["proposal"]
    confirmed = mark_confirmed(tmp_path, session["id"], transactions=first)
    assert confirmed["confirmed_count"] == 1
    assert confirmed["confirmed_at"]
    assert confirmed["proposal"] is None
    assert confirmed["confirmed_transactions"] == first
    assert confirmed["proposal_dirty"] == 0
    assert confirmed["pending_proposal"] is None

    second = [{"date": "2026-08-03", "postings": []}]
    saved_again = save_session(
        tmp_path,
        session["id"],
        expected_revision=confirmed["revision"],
        messages=[_message("again")],
        proposal=second,
    )
    assert saved_again["proposal"] == second
    assert saved_again["confirmed_transactions"] == first

    confirmed_again = mark_confirmed(tmp_path, session["id"], transactions=second)
    assert confirmed_again["proposal"] is None
    assert confirmed_again["confirmed_count"] == 2
    assert confirmed_again["confirmed_transactions"] == first + second

    archive_session(tmp_path, session["id"])
    assert list_sessions(tmp_path)["sessions"] == []
    with pytest.raises(HistoryError, match="不存在"):
        get_session(tmp_path, session["id"])


def test_list_pagination(tmp_path):
    for number in range(65):
        create_session(tmp_path, title=str(number))

    first = list_sessions(tmp_path, limit=30)
    assert len(first["sessions"]) == 30
    assert first["has_more"] is True
    second = list_sessions(tmp_path, limit=30, offset=30)
    assert len(second["sessions"]) == 30
    assert second["has_more"] is True
    third = list_sessions(tmp_path, limit=30, offset=60)
    assert len(third["sessions"]) == 5
    assert third["has_more"] is False


def test_rejects_database_from_newer_version(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    with sqlite3.connect(history_path(tmp_path)) as connection:
        connection.execute("PRAGMA user_version = 999")

    with pytest.raises(HistoryError, match="更新版本"):
        list_sessions(tmp_path)
