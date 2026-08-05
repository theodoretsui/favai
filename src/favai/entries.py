"""Validate, convert, and write proposed transactions."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_AMOUNT_RE = re.compile(r"^-?\d+(\.\d+)?$")
_TAG_RE = re.compile(r"^[A-Za-z0-9._/-]+$")


class EntryError(ValueError):
    """Raised when a proposed transaction is invalid."""


def _normalise_tag(value: Any) -> str:
    tag = str(value).strip().removeprefix("#")
    if not tag or not _TAG_RE.fullmatch(tag):
        msg = f"标签格式无效：{value!r}"
        raise EntryError(msg)
    return tag


def _posting_to_fava(posting: dict[str, Any], default_currency: str) -> dict[str, str]:
    account = str(posting.get("account", "")).strip()
    if not account:
        msg = "posting 缺少 account"
        raise EntryError(msg)
    amount = str(posting.get("amount") or "").strip()
    currency = str(posting.get("currency") or "").strip() or default_currency
    if amount:
        if not _AMOUNT_RE.match(amount):
            msg = f"金额格式无效：{amount!r}"
            raise EntryError(msg)
        amount_str = f"{amount} {currency}"
    else:
        amount_str = ""  # balancing posting
    return {"account": account, "amount": amount_str}


def to_fava_entry(txn: dict[str, Any], default_currency: str = "CNY") -> dict[str, Any]:
    """Convert one proposed transaction to fava's ``deserialise`` input shape.

    Raises:
        EntryError: If the transaction is structurally invalid.
    """
    date = str(txn.get("date", "")).strip()
    if not _DATE_RE.match(date):
        msg = f"日期格式无效：{date!r}（应为 YYYY-MM-DD）"
        raise EntryError(msg)
    postings = txn.get("postings")
    if not isinstance(postings, list) or len(postings) < 2:
        msg = f"交易「{txn.get('narration', '?')}」至少需要两条 postings"
        raise EntryError(msg)
    unspecified = [p for p in postings if not str(p.get("amount") or "").strip()]
    if len(unspecified) > 1:
        msg = f"交易「{txn.get('narration', '?')}」有多条 postings 缺少金额"
        raise EntryError(msg)
    proposal_flag = str(txn.get("flag") or "complete").strip()
    try:
        flag = {"complete": "*", "incomplete": "!"}[proposal_flag]
    except KeyError as exc:
        msg = f"交易 flag 无效：{proposal_flag!r}"
        raise EntryError(msg) from exc
    return {
        "t": "Transaction",
        "date": date,
        "flag": flag,
        "payee": str(txn.get("payee") or ""),
        "narration": str(txn.get("narration") or ""),
        "tags": [_normalise_tag(tag) for tag in txn.get("tags") or []],
        "links": [str(l) for l in txn.get("links") or []],
        "meta": {},
        "postings": [_posting_to_fava(p, default_currency) for p in postings],
    }


def to_fava_entries(
    transactions: list[dict[str, Any]], default_currency: str = "CNY"
) -> list[dict[str, Any]]:
    """Convert a list of proposed transactions."""
    if not transactions:
        msg = "没有可写入的交易"
        raise EntryError(msg)
    return [to_fava_entry(txn, default_currency) for txn in transactions]


def source_file_options(ledger: Any) -> tuple[list[str], str]:
    """Return writable source files and the default path, relative to the ledger."""
    root = Path(ledger.beancount_file_path).resolve().parent
    sources = {
        str(_resolve_path(filename, root))
        for filename in ledger.options.get("include", [])
        if _resolve_path(filename, root).is_file()
    }
    main_file = Path(ledger.beancount_file_path).resolve()
    if main_file.is_file():
        sources.add(str(main_file))

    paths = sorted(_display_path(Path(filename), root) for filename in sources)
    configured_default = ledger.fava_options.default_file
    default_file = (
        _resolve_path(configured_default, root) if configured_default else main_file
    )
    default_path = _display_path(default_file, root)
    if default_path not in paths:
        default_path = _display_path(main_file, root)
    return paths, default_path


def resolve_source_file(ledger: Any, write_path: str) -> Path:
    """Resolve a user-selected path and require it to be a loaded source file."""
    root = Path(ledger.beancount_file_path).resolve().parent
    candidate = Path(write_path)
    if not candidate.is_absolute():
        candidate = root / candidate
    candidate = candidate.resolve()

    allowed = {
        _resolve_path(filename, root) for filename in ledger.options.get("include", [])
    }
    allowed.add(Path(ledger.beancount_file_path).resolve())
    if candidate not in allowed or not candidate.is_file():
        msg = f"写入路径不是当前账本的源文件：{write_path}"
        raise EntryError(msg)
    return candidate


def write_entries(ledger: Any, entries: list[Any], write_path: str | None) -> None:
    """Write entries using Fava's default routing or an explicit source file."""
    if not write_path:
        ledger.file.insert_entries(entries)
        return

    path = resolve_source_file(ledger, write_path)
    source, checksum = ledger.file.get_source(path)
    rendered = "\n".join(
        str(entry).rstrip("\n") for entry in ledger.file.render_entries(entries)
    )
    if not rendered:
        msg = "没有可写入的交易"
        raise EntryError(msg)

    if source:
        source = source.rstrip("\n") + "\n\n"
    ledger.file.set_source(path, source + rendered + "\n", checksum)


def _display_path(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _resolve_path(path: str | Path, root: Path) -> Path:
    candidate = Path(path)
    return (candidate if candidate.is_absolute() else root / candidate).resolve()
