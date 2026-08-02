"""Tests for favai conversation history."""

from __future__ import annotations

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
        tmp_path, title="A conversation", model_api="openai", model_name="m"
    )

    assert session["title"] == "A conversation"
    assert session["messages"] == []
    assert session["revision"] == 0
    assert history_path(tmp_path).exists()

    result = list_sessions(tmp_path)
    assert [item["id"] for item in result["sessions"]] == [session["id"]]
    assert result["has_more"] is False


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

    confirmed = mark_confirmed(tmp_path, session["id"], count=2)
    assert confirmed["confirmed_count"] == 2
    assert confirmed["confirmed_at"]
    assert confirmed["proposal"] == saved["proposal"]
    assert confirmed["proposal_dirty"] == 0
    assert confirmed["pending_proposal"] is None

    archive_session(tmp_path, session["id"])
    assert list_sessions(tmp_path)["sessions"] == []
    with pytest.raises(HistoryError, match="不存在"):
        get_session(tmp_path, session["id"])


def test_list_pagination(tmp_path):
    for number in range(3):
        create_session(tmp_path, title=str(number))

    first = list_sessions(tmp_path, limit=2)
    assert len(first["sessions"]) == 2
    assert first["has_more"] is True
    second = list_sessions(tmp_path, limit=2, offset=2)
    assert len(second["sessions"]) == 1
    assert second["has_more"] is False


def test_rejects_database_from_newer_version(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    with sqlite3.connect(history_path(tmp_path)) as connection:
        connection.execute("PRAGMA user_version = 999")

    with pytest.raises(HistoryError, match="更新版本"):
        list_sessions(tmp_path)
