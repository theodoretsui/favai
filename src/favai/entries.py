"""Convert proposed transaction dicts into fava's serialisation shape."""

from __future__ import annotations

import re
from typing import Any

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_AMOUNT_RE = re.compile(r"^-?\d+(\.\d+)?$")


class EntryError(ValueError):
    """Raised when a proposed transaction is invalid."""


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
    return {
        "t": "Transaction",
        "date": date,
        "flag": "*",
        "payee": str(txn.get("payee") or ""),
        "narration": str(txn.get("narration") or ""),
        "tags": [str(t) for t in txn.get("tags") or []],
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
