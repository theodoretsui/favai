"""Typed ledger entry proposals: change sets, canonical rendering, validation.

This module implements the shared ``LedgerChangeSet`` contract behind the
``propose_transactions`` v2 and ``propose_directives`` tools.  Neither tool
writes a file; they update one pending change set per conversation, and the
actual write is an application command bound to the exact change-set revision
and target source file.

The backend owns canonical rendering and ledger-context validation.  Raw
Beancount source is never accepted from the model, and directive types outside
the allowlist are rejected before write.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from favai.entries import EntryError, resolve_source_file, source_file_options

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SIGNED_NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")
_UNSIGNED_NUM_RE = re.compile(r"^\d+(\.\d+)?$")
_CURRENCY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_META_KEY_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_FLAG_RE = re.compile(r"^[A-Za-z!?*]$")
_BOOKING_METHODS = frozenset({"NONE", "STRICT", "AVERAGE", "FIFO", "LIFO", "HIFO"})
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
_WHITESPACE_RE = re.compile(r"\s")

ALLOWED_DIRECTIVES = frozenset(
    {"open", "commodity", "price", "balance", "note", "event"}
)


def _source_path(ledger: Any, path: Path) -> Path:
    """Return a ``Path`` fava recognizes as a source file.

    ``fava.core.file.get_source`` compares ``str(path)`` against
    ``options["include"]`` by string equality.  On macOS the resolved path
    can differ by a ``/var -> /private/var`` symlink, so match on the
    resolved form and hand back fava's own path object.
    """
    target = path.resolve()
    for candidate in ledger.options.get("include", []):
        if Path(candidate).resolve() == target:
            return Path(candidate)
    return path


def _valid_text(value: Any, what: str, allow_whitespace: bool = True) -> str:
    """Validate a free-text field, rejecting control characters.

    Newlines and control characters would break the canonical single-line
    rendering, so they are rejected rather than silently escaped.
    """
    text = str(value or "").strip()
    if _CONTROL_RE.search(text):
        msg = f"{what}包含不允许的控制字符"
        raise EntryError(msg)
    if not allow_whitespace and _WHITESPACE_RE.search(text):
        msg = f"{what}不能包含空白字符"
        raise EntryError(msg)
    return text


def _valid_date(value: Any, what: str) -> str:
    raw = str(value or "").strip()
    if not _DATE_RE.match(raw):
        msg = f"{what}日期格式无效：{value!r}（应为 YYYY-MM-DD）"
        raise EntryError(msg)
    return raw


def _valid_account(value: Any) -> str:
    account = str(value or "").strip()
    if not account:
        msg = f"账户名不可为空：{value!r}"
        raise EntryError(msg)
    if _CONTROL_RE.search(account):
        msg = f"账户名无效：{account!r} 包含不允许的控制字符"
        raise EntryError(msg)
    if _WHITESPACE_RE.search(account):
        msg = f"账户名无效：{account!r} 包含空格"
        raise EntryError(msg)
    # Use the same Beancount parser that will consume the rendered source.
    # This lets CJK characters appear from the third component onward, just
    # like Beancount itself allows, instead of forcing an ASCII-only regex.
    from beancount.parser.parser import parse_string

    _, errors, _ = parse_string(f"1900-01-01 open {account} CNY\n")
    if errors:
        msg = f"账户名无效：{account!r} 无法通过beancount校验"
        raise EntryError(msg)
    return account


def _valid_currency(value: Any, what: str = "币种") -> str:
    currency = str(value or "").strip()
    if not _CURRENCY_RE.match(currency):
        msg = f"{what}无效：{value!r}"
        raise EntryError(msg)
    return currency


def _valid_meta(meta: Any) -> dict[str, Any]:
    """Validate and normalize bounded metadata values.

    Only strings, numbers, booleans, and date strings are accepted; any other
    JSON shape is rejected so a proposal field can never smuggle in raw source.
    """
    if meta is None:
        return {}
    if not isinstance(meta, dict):
        msg = "metadata 必须是对象"
        raise EntryError(msg)
    normalized: dict[str, Any] = {}
    for key, value in meta.items():
        key = str(key).strip()
        if not _META_KEY_RE.match(key):
            msg = f"metadata 键无效：{key!r}"
            raise EntryError(msg)
        if isinstance(value, str):
            normalized[key] = _valid_text(value, f"metadata「{key}」")
        elif isinstance(value, bool) or (
            isinstance(value, (int, float)) and not isinstance(value, bool)
        ):
            normalized[key] = value
        else:
            msg = f"metadata「{key}」的值类型不受支持：{value!r}"
            raise EntryError(msg)
    return normalized


def _valid_posting_flag(value: Any) -> str | None:
    if value is None or str(value) == "":
        return None
    flag = str(value).strip()
    if not _FLAG_RE.match(flag):
        msg = f"分录 flag 无效：{value!r}（应为单个字母）"
        raise EntryError(msg)
    return flag


def _valid_cost(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        msg = "cost 必须是对象"
        raise EntryError(msg)
    kind = str(value.get("kind") or "").strip()
    if kind not in {"per_unit", "total", "compound"}:
        msg = f"cost.kind 无效：{kind!r}"
        raise EntryError(msg)
    currency = _valid_currency(value.get("currency"), "cost 币种")
    lot_date: str | None = None
    if value.get("date") not in (None, ""):
        lot_date = _valid_date(value.get("date"), "cost 起息日")
    number_re = _UNSIGNED_NUM_RE
    if kind == "compound":
        per_number = str(value.get("per_number") or "").strip()
        total_number = str(value.get("total_number") or "").strip()
        if not number_re.match(per_number) or not number_re.match(total_number):
            msg = "compound cost 需要非负的 per_number 和 total_number"
            raise EntryError(msg)
        return {
            "kind": kind,
            "per_number": per_number,
            "total_number": total_number,
            "currency": currency,
            "date": lot_date,
        }
    number = str(value.get("number") or "").strip()
    if not number_re.match(number):
        msg = f"cost.number 无效：{number!r}（应为非负数）"
        raise EntryError(msg)
    return {"kind": kind, "number": number, "currency": currency, "date": lot_date}


def _valid_price(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        msg = "price 必须是对象"
        raise EntryError(msg)
    kind = str(value.get("kind") or "").strip()
    if kind not in {"per_unit", "total"}:
        msg = f"price.kind 无效：{kind!r}"
        raise EntryError(msg)
    number = str(value.get("number") or "").strip()
    if not _UNSIGNED_NUM_RE.match(number):
        msg = f"price.number 无效：{number!r}（应为非负数）"
        raise EntryError(msg)
    return {
        "kind": kind,
        "number": number,
        "currency": _valid_currency(value.get("currency"), "price 币种"),
    }


def _valid_units(value: Any) -> dict[str, str] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        msg = "units 必须是对象"
        raise EntryError(msg)
    number = str(value.get("number") or "").strip()
    if not _SIGNED_NUM_RE.match(number):
        msg = f"units.number 无效：{number!r}（应为有符号数字）"
        raise EntryError(msg)
    return {
        "number": number,
        "currency": _valid_currency(value.get("currency"), "units 币种"),
    }


def validate_posting(posting: dict[str, Any], index: int) -> dict[str, Any]:
    """Validate and normalize one typed posting."""
    if not isinstance(posting, dict):
        msg = f"第 {index} 条分录必须是对象"
        raise EntryError(msg)
    account = _valid_account(posting.get("account"))
    flag = _valid_posting_flag(posting.get("flag"))
    units = _valid_units(posting.get("units"))
    cost = _valid_cost(posting.get("cost"))
    price = _valid_price(posting.get("price"))
    meta = _valid_meta(posting.get("metadata"))
    if units is None and cost is not None:
        msg = f"分录「{account}」缺少 units 却带有 cost，无法插值"
        raise EntryError(msg)
    return {
        "account": account,
        "flag": flag,
        "units": units,
        "cost": cost,
        "price": price,
        "metadata": meta,
    }


def validate_transaction(txn: dict[str, Any], index: int) -> dict[str, Any]:
    """Validate and normalize one typed transaction."""
    if not isinstance(txn, dict):
        msg = f"第 {index} 笔交易必须是对象"
        raise EntryError(msg)
    date = _valid_date(txn.get("date"), "交易")
    flag = str(txn.get("flag") or "complete").strip()
    if flag not in {"complete", "incomplete"}:
        msg = f"交易 flag 无效：{flag!r}"
        raise EntryError(msg)
    postings_raw = txn.get("postings")
    if not isinstance(postings_raw, list) or len(postings_raw) < 2:
        msg = f"交易「{txn.get('narration', '?')}」至少需要两条分录"
        raise EntryError(msg)
    postings = [validate_posting(p, i + 1) for i, p in enumerate(postings_raw)]
    missing_units = [p for p in postings if p["units"] is None]
    if len(missing_units) > 1:
        msg = f"交易「{txn.get('narration', '?')}」有多条分录缺少 units，无法插值"
        raise EntryError(msg)
    tags = [
        _valid_text(tag, "标签", allow_whitespace=False).removeprefix("#")
        for tag in txn.get("tags") or []
    ]
    tags = [tag for tag in tags if tag]
    links = [
        _valid_text(link, "链接", allow_whitespace=False)
        for link in txn.get("links") or []
    ]
    links = [link for link in links if link]
    return {
        "date": date,
        "flag": flag,
        "payee": _valid_text(txn.get("payee"), "收款方"),
        "narration": _valid_text(txn.get("narration"), "摘要"),
        "tags": tags,
        "links": links,
        "metadata": _valid_meta(txn.get("metadata")),
        "postings": postings,
    }


def _valid_amount(value: Any, what: str) -> dict[str, str]:
    if not isinstance(value, dict):
        msg = f"{what} 必须是 {what}对象"
        raise EntryError(msg)
    number = str(value.get("number") or "").strip()
    if not _SIGNED_NUM_RE.match(number):
        msg = f"{what}.number 无效：{value.get('number')!r}"
        raise EntryError(msg)
    return {
        "number": number,
        "currency": _valid_currency(value.get("currency"), f"{what} 币种"),
    }


def validate_directive(directive: dict[str, Any], index: int) -> dict[str, Any]:
    """Validate and normalize one typed directive from the allowlist."""
    if not isinstance(directive, dict):
        msg = f"第 {index} 条指令必须是对象"
        raise EntryError(msg)
    dtype = str(directive.get("kind") or directive.get("type") or "").strip()
    if dtype not in ALLOWED_DIRECTIVES:
        msg = f"不支持的指令类型：{dtype!r}"
        raise EntryError(msg)
    date = _valid_date(directive.get("date"), "指令")
    meta = _valid_meta(directive.get("metadata"))
    if dtype == "open":
        account = _valid_account(directive.get("account"))
        currencies = [str(c).strip() for c in directive.get("currencies") or []]
        currencies = [_valid_currency(c) for c in currencies if c]
        booking = str(directive.get("booking") or "").strip().upper()
        if booking and booking not in _BOOKING_METHODS:
            msg = f"open booking 无效：{booking!r}"
            raise EntryError(msg)
        return {
            "type": dtype,
            "date": date,
            "account": account,
            "currencies": currencies,
            "booking": booking or None,
            "metadata": meta,
        }
    if dtype == "commodity":
        return {
            "type": dtype,
            "date": date,
            "currency": _valid_currency(directive.get("currency"), "commodity 币种"),
            "metadata": meta,
        }
    if dtype == "price":
        return {
            "type": dtype,
            "date": date,
            "commodity": _valid_currency(directive.get("commodity"), "price 商品"),
            "amount": _valid_amount(directive.get("amount"), "price 金额"),
            "metadata": meta,
        }
    if dtype == "balance":
        return {
            "type": dtype,
            "date": date,
            "account": _valid_account(directive.get("account")),
            "amount": _valid_amount(directive.get("amount"), "balance 金额"),
            "metadata": meta,
        }
    if dtype == "note":
        return {
            "type": dtype,
            "date": date,
            "account": _valid_account(directive.get("account")),
            "comment": _valid_text(directive.get("comment"), "note 内容"),
            "metadata": meta,
        }
    # event: the plan's field list is (date, type, description); ``kind``
    # carries the directive discriminator so ``type`` stays free for the
    # event's own type.
    return {
        "type": dtype,
        "date": date,
        "event_type": _valid_text(directive.get("type"), "event 类型"),
        "description": _valid_text(directive.get("description"), "event 描述"),
        "metadata": meta,
    }


# ---------------------------------------------------------------------------
# canonical rendering
# ---------------------------------------------------------------------------


def _render_meta_lines(meta: dict[str, Any], indent: str = "  ") -> list[str]:
    lines: list[str] = []
    for key in sorted(meta):
        value = meta[key]
        if isinstance(value, str):
            rendered = f'"{value.replace(chr(34), chr(92) + chr(34))}"'
        elif isinstance(value, bool):
            rendered = "TRUE" if value else "FALSE"
        elif isinstance(value, float):
            rendered = format(value, "f").rstrip("0").rstrip(".")
        else:
            rendered = str(value)
        lines.append(f"{indent}{key}: {rendered}")
    return lines


def render_posting(posting: dict[str, Any]) -> list[str]:
    """Render one normalized posting into canonical Beancount lines."""
    flag = f"{posting['flag']} " if posting["flag"] else ""
    prefix = f"  {flag}{posting['account']}"
    if posting["units"] is not None:
        units = posting["units"]
        cost = posting["cost"]
        price = posting["price"]
        cost_text = ""
        if cost is not None:
            if cost["kind"] == "per_unit":
                cost_text = f"{{{cost['number']} {cost['currency']}"
            elif cost["kind"] == "total":
                cost_text = f"{{{{{cost['number']} {cost['currency']}"
            else:
                cost_text = (
                    f"{{{cost['per_number']} # {cost['total_number']} "
                    f"{cost['currency']}"
                )
            if cost.get("date"):
                cost_text += f", {cost['date']}"
            cost_text += "}" if cost["kind"] != "total" else "}}"
        price_text = ""
        if price is not None:
            marker = "@" if price["kind"] == "per_unit" else "@@"
            price_text = f" {marker} {price['number']} {price['currency']}"
        amount = f"{units['number']} {units['currency']}"
        if cost_text:
            amount += f" {cost_text}"
        amount += price_text
        lines = [f"{prefix}  {amount}"]
    else:
        lines = [prefix]
    lines.extend(_render_meta_lines(posting["metadata"]))
    return lines


def render_transaction(txn: dict[str, Any]) -> str:
    """Render one normalized transaction into canonical Beancount source."""
    flag = "*" if txn["flag"] == "complete" else "!"
    payee = f'"{txn["payee"].replace(chr(34), chr(92) + chr(34))}"'
    narration = f'"{txn["narration"].replace(chr(34), chr(92) + chr(34))}"'
    line = f"{txn['date']} {flag} {payee} {narration}"
    for tag in txn["tags"]:
        line += f" #{tag}"
    for link in txn["links"]:
        line += f" ^{link}"
    lines = [line]
    lines.extend(_render_meta_lines(txn["metadata"]))
    for posting in txn["postings"]:
        lines.extend(render_posting(posting))
    return "\n".join(lines)


def render_directive(directive: dict[str, Any]) -> str:
    """Render one normalized directive into canonical Beancount source."""
    d = directive
    dtype = d["type"]
    if dtype == "open":
        line = f"{d['date']} open {d['account']}"
        if d["currencies"]:
            line += " " + ",".join(d["currencies"])
        if d["booking"]:
            line += f" {d['booking']}"
    elif dtype == "commodity":
        line = f"{d['date']} commodity {d['currency']}"
    elif dtype == "price":
        line = f"{d['date']} price {d['commodity']} {d['amount']['number']} {d['amount']['currency']}"
    elif dtype == "balance":
        line = f"{d['date']} balance {d['account']} {d['amount']['number']} {d['amount']['currency']}"
    elif dtype == "note":
        comment = d["comment"].replace(chr(34), chr(92) + chr(34))
        line = f'{d["date"]} note {d["account"]} "{comment}"'
    else:  # event
        event_type = d["event_type"].replace(chr(34), chr(92) + chr(34))
        description = d["description"].replace(chr(34), chr(92) + chr(34))
        line = f'{d["date"]} event "{event_type}" "{description}"'
    lines = [line]
    lines.extend(_render_meta_lines(d["metadata"]))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# parse-back verification and ledger-context validation
# ---------------------------------------------------------------------------


def _parse_rendered(text: str) -> list[Any]:
    from beancount.parser.parser import parse_string

    entries, errors, _options = parse_string(text)
    if errors:
        details = "; ".join(str(e) for e in errors[:5])
        msg = f"渲染结果无法解析：{details}"
        raise EntryError(msg)
    return entries


def _verify_roundtrip(
    txns: list[dict[str, Any]],
    directives: list[dict[str, Any]],
    parsed: list[Any],
) -> None:
    """Verify the parsed entries match the typed proposals exactly.

    The beancount parser sorts entries (date + directive priority), so
    matching is order-independent: directives by (type, date) and
    transactions by a content fingerprint.
    """
    from decimal import Decimal

    from beancount.core.number import MISSING

    expected_count = len(txns) + len(directives)
    if len(parsed) != expected_count:
        msg = f"渲染结果与提案不一致：期望 {expected_count} 条，解析到 {len(parsed)} 条"
        raise EntryError(msg)

    directive_kinds = {
        "Open": "open",
        "Commodity": "commodity",
        "Price": "price",
        "Balance": "balance",
        "Note": "note",
        "Event": "event",
    }
    remaining_directives = {(d["type"], d["date"]): d for d in directives}
    remaining_txns: list[tuple[dict[str, Any], list[Any]]] = []
    for txn in txns:
        remaining_txns.append((txn, list(txn["postings"])))

    for entry in parsed:
        kind = type(entry).__name__
        if kind in directive_kinds:
            key = (directive_kinds[kind], entry.date.isoformat())
            if key not in remaining_directives:
                msg = f"渲染出多余的指令：{kind} {entry.date.isoformat()}"
                raise EntryError(msg)
            remaining_directives.pop(key)
            continue
        # Transaction
        fingerprint = (
            entry.date.isoformat(),
            str(entry.narration),
            tuple(
                (
                    posting.account,
                    posting.units.number
                    if posting.units is not None and posting.units is not MISSING
                    else None,
                    posting.units.currency
                    if posting.units is not None and posting.units is not MISSING
                    else None,
                    posting.cost is not None,
                    posting.price is not None,
                )
                for posting in entry.postings
            ),
        )
        matched = None
        for txn, postings in remaining_txns:
            expected_fingerprint = (
                txn["date"],
                txn["narration"],
                tuple(
                    (
                        posting["account"],
                        Decimal(posting["units"]["number"])
                        if posting["units"] is not None
                        else None,
                        posting["units"]["currency"]
                        if posting["units"] is not None
                        else None,
                        posting["cost"] is not None,
                        posting["price"] is not None,
                    )
                    for posting in postings
                ),
            )
            if expected_fingerprint == fingerprint:
                matched = (txn, postings)
                break
        if matched is None:
            msg = f"渲染结果与提案不一致：找不到匹配的交易「{entry.narration}」"
            raise EntryError(msg)
        remaining_txns.remove(matched)

    if remaining_directives or remaining_txns:
        msg = "渲染结果与提案不一致：部分提案未被正确渲染"
        raise EntryError(msg)


def validate_in_context(ledger: Any, proposed_entries: list[Any]) -> list[str]:
    """Validate the combined ledger in context; return only proposed-entry errors."""
    from beancount.core import data
    from beancount.core.position import Cost, CostSpec
    from beancount.ops import validation
    from beancount.ops.balance import check as balance_check
    from beancount.parser import booking

    # Fava exposes entries after Beancount booking, so their posting costs are
    # ``Cost`` instances. ``booking.book`` expects parser output instead and
    # accesses ``CostSpec.number_per`` when it needs to interpolate a posting.
    # Recreate the equivalent parser representation before booking the combined
    # ledger. This also makes context validation robust when an existing entry
    # contains an amount that Beancount needs to interpolate again.
    existing: list[Any] = []
    for entry in ledger.all_entries:
        if not isinstance(entry, data.Transaction):
            existing.append(entry)
            continue
        postings = []
        changed = False
        for posting in entry.postings:
            cost = posting.cost
            if isinstance(cost, Cost):
                cost = CostSpec(
                    cost.number,
                    None,
                    cost.currency,
                    cost.date,
                    cost.label,
                    False,
                )
                posting = posting._replace(cost=cost)
                changed = True
            postings.append(posting)
        existing.append(entry._replace(postings=postings) if changed else entry)
    combined = existing + proposed_entries
    combined.sort(key=data.entry_sortkey)
    options_map = ledger.options

    booked, booking_errors = booking.book(combined, options_map)
    valid_errors = validation.validate(booked, options_map)
    _, balance_errors = balance_check(booked, options_map)

    proposed = {id(e) for e in proposed_entries}
    messages: list[str] = []
    for err in [*booking_errors, *valid_errors, *balance_errors]:
        entry = getattr(err, "entry", None)
        if entry is not None and id(entry) not in proposed:
            # Booking may replace an entry with a new object while keeping its
            # meta; match on either identity or our controlled source filename.
            filename = (entry.meta or {}).get("filename")
            if filename != "<string>":
                continue
        messages.append(str(getattr(err, "message", err)))
    return messages


# ---------------------------------------------------------------------------
# change set
# ---------------------------------------------------------------------------


@dataclass
class LedgerChangeSet:
    """One pending, user-confirmable set of ledger changes."""

    id: str
    revision: int = 0
    transactions: list[dict[str, Any]] = field(default_factory=list)
    directives: list[dict[str, Any]] = field(default_factory=list)
    target_file: str | None = None
    preview: str = ""
    source_checksum: str = ""
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    provenance: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "revision": self.revision,
            "transaction_count": len(self.transactions),
            "directive_count": len(self.directives),
            "target_file": self.target_file,
            "preview": self.preview,
            "errors": self.errors,
            "warnings": self.warnings,
        }


class ChangeSetStore:
    """Per-session pending change sets for one extension instance."""

    def __init__(self) -> None:
        self._sets: dict[str, LedgerChangeSet] = {}

    def get(self, session_id: str) -> LedgerChangeSet | None:
        return self._sets.get(session_id)

    def update(
        self,
        session_id: str,
        tool: str,
        batch: dict[str, Any],
        ledger: Any,
        target_file: str | None = None,
    ) -> LedgerChangeSet:
        """Replace one batch in the change set and revalidate everything.

        A retry replaces its own latest batch instead of appending, so a
        repaired submission never duplicates entries.  Raises EntryError when
        ledger-context validation fails so the agent records a tool error and
        can repair the batch.
        """
        if tool not in {"transactions", "directives"}:
            msg = f"未知的提案工具：{tool!r}"
            raise EntryError(msg)
        change_set = self._sets.get(session_id)
        if change_set is None:
            change_set = LedgerChangeSet(id=uuid.uuid4().hex)
        if tool == "transactions":
            txns = batch.get("transactions") or []
            if not isinstance(txns, list) or not txns:
                msg = "propose_transactions 需要至少一笔交易"
                raise EntryError(msg)
            change_set.transactions = [
                validate_transaction(t, i + 1) for i, t in enumerate(txns)
            ]
        else:
            directives = batch.get("directives") or []
            if not isinstance(directives, list) or not directives:
                msg = "propose_directives 需要至少一条指令"
                raise EntryError(msg)
            change_set.directives = [
                validate_directive(d, i + 1) for i, d in enumerate(directives)
            ]
        change_set.revision += 1
        change_set.provenance[tool] = change_set.revision

        # Target file: the ledger's default write file unless overridden.
        if target_file:
            change_set.target_file = target_file
        else:
            _paths, default_path = source_file_options(ledger)
            change_set.target_file = change_set.target_file or default_path
        path = resolve_source_file(ledger, change_set.target_file)
        _source, checksum = ledger.file.get_source(_source_path(ledger, path))
        change_set.source_checksum = checksum

        change_set.preview = render_all(change_set)
        parsed = _parse_rendered(change_set.preview)
        _verify_roundtrip(change_set.transactions, change_set.directives, parsed)
        errors = validate_in_context(ledger, parsed)
        change_set.errors = errors
        change_set.warnings = []
        # Store first: a failed validation must still compose with later tool
        # calls (e.g. an ``open`` directive added after a transaction that
        # referenced a new account).
        self._sets[session_id] = change_set
        if errors:
            detail = "\n".join(errors[:10])
            msg = f"提案校验失败：\n{detail}"
            raise EntryError(msg)
        return change_set


def render_all(change_set: LedgerChangeSet) -> str:
    """Render the whole change set into canonical Beancount source."""
    blocks: list[str] = []
    for directive in change_set.directives:
        blocks.append(render_directive(directive))
    for txn in change_set.transactions:
        blocks.append(render_transaction(txn))
    return "\n\n".join(blocks)


def confirm_change_set(
    ledger: Any,
    store: ChangeSetStore,
    session_id: str,
    revision: int,
    write_path: str | None,
) -> dict[str, Any]:
    """Write the reviewed change set; bound to its exact revision.

    Rechecks the target checksum and revalidates the combined ledger before
    mutation, so a concurrent user edit or a changed proposal is never
    silently overwritten.
    """
    change_set = store.get(session_id)
    if change_set is None:
        msg = "没有待确认的提案，请先让助手提交交易或指令"
        raise EntryError(msg)
    if change_set.revision != int(revision):
        msg = "提案已被更新，请查看最新预览后重新确认"
        raise EntryError(msg)

    # Revalidate against the current ledger state.
    preview = render_all(change_set)
    parsed = _parse_rendered(preview)
    _verify_roundtrip(change_set.transactions, change_set.directives, parsed)
    errors = validate_in_context(ledger, parsed)
    if errors:
        detail = "\n".join(errors[:10])
        msg = f"提案校验失败，已阻止写入：\n{detail}"
        raise EntryError(msg)

    path = resolve_source_file(ledger, write_path or change_set.target_file)
    source_path = _source_path(ledger, path)
    source, current_checksum = ledger.file.get_source(source_path)
    if path == resolve_source_file(ledger, change_set.target_file) and (
        current_checksum != change_set.source_checksum
    ):
        # Only the checksum observed during validation is meaningful for the
        # same file; a different user-chosen target was just revalidated
        # against the current ledger state above.
        msg = "源文件已被修改，请刷新后重新确认"
        raise EntryError(msg)

    rendered = preview.rstrip("\n") + "\n"
    if source:
        source = source.rstrip("\n") + "\n\n"
    ledger.file.set_source(source_path, source + rendered, current_checksum)
    return {
        "inserted": len(change_set.transactions) + len(change_set.directives),
        "write_path": str(write_path or change_set.target_file),
    }
