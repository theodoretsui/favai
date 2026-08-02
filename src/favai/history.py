"""Ledger-local conversation history storage."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 2
MAX_STATE_BYTES = 8 * 1024 * 1024


class HistoryError(ValueError):
    """Raised when conversation history cannot be read or updated."""


def history_path(data_dir: Path) -> Path:
    """Return the SQLite history path for a favai data directory."""
    return data_dir / "history.sqlite3"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _connect(data_dir: Path) -> sqlite3.Connection:
    data_dir.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(history_path(data_dir), timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    _migrate(connection)
    return connection


def _migrate(connection: sqlite3.Connection) -> None:
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version > SCHEMA_VERSION:
        raise HistoryError("会话历史由更新版本的 favai 创建，当前版本无法读取")
    if version == 0:
        with connection:
            connection.execute(
                """
                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    archived INTEGER NOT NULL DEFAULT 0,
                    revision INTEGER NOT NULL DEFAULT 0,
                    model_provider TEXT NOT NULL DEFAULT '',
                    model_api TEXT NOT NULL DEFAULT '',
                    model_name TEXT NOT NULL DEFAULT '',
                    messages_json TEXT NOT NULL DEFAULT '[]',
                    proposal_json TEXT,
                    proposal_dirty INTEGER NOT NULL DEFAULT 0,
                    pending_proposal_json TEXT,
                    confirmed_at TEXT,
                    confirmed_count INTEGER
                )
                """
            )
            connection.execute(
                "CREATE INDEX sessions_updated_at ON sessions(updated_at DESC)"
            )
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        return
    if version < 2:
        with connection:
            connection.execute(
                "ALTER TABLE sessions ADD COLUMN model_provider TEXT NOT NULL DEFAULT ''"
            )
            connection.execute("PRAGMA user_version = 2")


def _encode(value: Any, field: str) -> str:
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise HistoryError(f"{field} 不是有效的 JSON 数据") from exc
    if len(encoded.encode("utf-8")) > MAX_STATE_BYTES:
        raise HistoryError(f"{field} 超过会话历史大小限制")
    return encoded


def _decode(value: str | None) -> Any:
    return json.loads(value) if value is not None else None


def _validate_messages(messages: Any) -> list[dict[str, Any]]:
    if not isinstance(messages, list):
        raise HistoryError("messages 必须是数组")
    allowed_roles = {"user", "assistant", "toolResult"}
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in allowed_roles:
            raise HistoryError("messages 包含无效消息")
        if not isinstance(message.get("timestamp"), (int, float)):
            raise HistoryError("messages 包含无效时间戳")
    return messages


def _title(value: Any, *, default: str = "新对话") -> str:
    title = str(value or default).strip()
    return title[:80] or default


def _default_title(now: datetime) -> str:
    """Return the default session title in the ledger server's local time."""
    return now.astimezone().strftime("%Y-%m-%d %H:%M:%S")


def create_session(
    data_dir: Path,
    *,
    title: str | None = None,
    model_provider: str = "",
    model_api: str = "",
    model_name: str = "",
) -> dict[str, Any]:
    """Create and return an empty conversation session."""
    session_id = str(uuid.uuid4())
    now_datetime = datetime.now(UTC)
    now = now_datetime.isoformat()
    with _connect(data_dir) as connection:
        connection.execute(
            """
            INSERT INTO sessions (
                id, title, created_at, updated_at, model_provider,
                model_api, model_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                _title(title, default=_default_title(now_datetime)),
                now,
                now,
                model_provider,
                model_api,
                model_name,
            ),
        )
    return get_session(data_dir, session_id)


def list_sessions(
    data_dir: Path, *, limit: int = 30, offset: int = 0
) -> dict[str, Any]:
    """List active sessions ordered by most recent update."""
    limit = min(max(int(limit), 1), 100)
    offset = max(int(offset), 0)
    with _connect(data_dir) as connection:
        rows = connection.execute(
            """
            SELECT id, title, created_at, updated_at, revision, model_provider,
                   model_api, model_name, proposal_json IS NOT NULL AS has_proposal,
                   proposal_dirty, confirmed_at, confirmed_count
            FROM sessions
            WHERE archived = 0
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?
            """,
            (limit + 1, offset),
        ).fetchall()
    return {
        "sessions": [dict(row) for row in rows[:limit]],
        "has_more": len(rows) > limit,
    }


def get_session(data_dir: Path, session_id: str) -> dict[str, Any]:
    """Load a complete active session."""
    with _connect(data_dir) as connection:
        row = connection.execute(
            "SELECT * FROM sessions WHERE id = ? AND archived = 0", (session_id,)
        ).fetchone()
    if row is None:
        raise HistoryError("会话不存在")
    result = dict(row)
    result["messages"] = _decode(result.pop("messages_json"))
    result["proposal"] = _decode(result.pop("proposal_json"))
    result["pending_proposal"] = _decode(result.pop("pending_proposal_json"))
    result.pop("archived")
    return result


def save_session(
    data_dir: Path,
    session_id: str,
    *,
    expected_revision: int,
    messages: Any,
    proposal: Any = None,
    proposal_dirty: bool = False,
    pending_proposal: Any = None,
    title: str | None = None,
) -> dict[str, Any]:
    """Atomically replace a session snapshot using optimistic locking."""
    messages_json = _encode(_validate_messages(messages), "messages")
    proposal_json = None if proposal is None else _encode(proposal, "proposal")
    pending_json = (
        None
        if pending_proposal is None
        else _encode(pending_proposal, "pending_proposal")
    )
    now = _now()
    assignments = """
        messages_json = ?, proposal_json = ?, proposal_dirty = ?,
        pending_proposal_json = ?, updated_at = ?, revision = revision + 1
    """
    parameters: list[Any] = [
        messages_json,
        proposal_json,
        int(proposal_dirty),
        pending_json,
        now,
    ]
    if title is not None:
        assignments += ", title = ?"
        parameters.append(_title(title))
    parameters.extend([session_id, int(expected_revision)])
    with _connect(data_dir) as connection:
        cursor = connection.execute(
            f"""
            UPDATE sessions SET {assignments}
            WHERE id = ? AND revision = ? AND archived = 0
            """,
            parameters,
        )
        if cursor.rowcount != 1:
            exists = connection.execute(
                "SELECT 1 FROM sessions WHERE id = ? AND archived = 0", (session_id,)
            ).fetchone()
            if exists:
                raise HistoryError("会话已在其他窗口中更新，请重新加载")
            raise HistoryError("会话不存在")
    return get_session(data_dir, session_id)


def rename_session(data_dir: Path, session_id: str, title: str) -> dict[str, Any]:
    """Rename a session and advance its revision."""
    with _connect(data_dir) as connection:
        cursor = connection.execute(
            """
            UPDATE sessions
            SET title = ?, updated_at = ?, revision = revision + 1
            WHERE id = ? AND archived = 0
            """,
            (_title(title), _now(), session_id),
        )
        if cursor.rowcount != 1:
            raise HistoryError("会话不存在")
    return get_session(data_dir, session_id)


def archive_session(data_dir: Path, session_id: str) -> None:
    """Soft-delete a session from the active history list."""
    with _connect(data_dir) as connection:
        cursor = connection.execute(
            "UPDATE sessions SET archived = 1, updated_at = ? WHERE id = ?",
            (_now(), session_id),
        )
        if cursor.rowcount != 1:
            raise HistoryError("会话不存在")


def mark_confirmed(data_dir: Path, session_id: str, *, count: int) -> dict[str, Any]:
    """Record that a session's proposal was written to the ledger."""
    with _connect(data_dir) as connection:
        cursor = connection.execute(
            """
            UPDATE sessions
            SET confirmed_at = ?, confirmed_count = ?, updated_at = ?,
                proposal_dirty = 0, pending_proposal_json = NULL,
                revision = revision + 1
            WHERE id = ? AND archived = 0
            """,
            (_now(), count, _now(), session_id),
        )
        if cursor.rowcount != 1:
            raise HistoryError("会话不存在")
    return get_session(data_dir, session_id)
