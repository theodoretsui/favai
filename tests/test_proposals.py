"""Tests for typed ledger entry proposals (change sets, rendering, validation)."""

from __future__ import annotations

import pathlib

import pytest

from favai.entries import EntryError
from favai.proposals import (
    ChangeSetStore,
    confirm_change_set,
    render_directive,
    render_transaction,
    validate_directive,
    validate_transaction,
)

LEDGER_SOURCE = """include "2026.beancount"
option "operating_currency" "CNY"
option "booking_method" "STRICT"

2026-01-01 open Assets:CN:Bank
2026-01-01 open Assets:Broker
2026-01-01 open Expenses:Food
2026-01-01 open Expenses:Broker:Fees
2026-01-01 open Income:CapitalGains USD
2026-01-01 commodity GOOG
2026-01-01 price GOOG 100.00 USD
"""


@pytest.fixture
def ledger(tmp_path: pathlib.Path):
    from fava.core import FavaLedger

    main = tmp_path / "main.beancount"
    sub = tmp_path / "2026.beancount"
    main.write_text(LEDGER_SOURCE)
    sub.write_text("; 2026\n")
    return FavaLedger(str(main)), main, sub


def store_update(store, session, tool, batch, ledger):
    return store.update(session, tool, batch, ledger)


def simple_txn(**overrides):
    txn = {
        "date": "2026-01-02",
        "narration": "lunch",
        "postings": [
            {
                "account": "Expenses:Food",
                "units": {"number": "50.00", "currency": "CNY"},
            },
            {
                "account": "Assets:CN:Bank",
                "units": {"number": "-50.00", "currency": "CNY"},
            },
        ],
    }
    txn.update(overrides)
    return txn


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------


def test_render_per_unit_cost():
    txn = validate_transaction(
        {
            "date": "2026-01-03",
            "narration": "buy",
            "postings": [
                {
                    "account": "Assets:Broker",
                    "units": {"number": "10", "currency": "GOOG"},
                    "cost": {"kind": "per_unit", "number": "502.12", "currency": "USD"},
                },
                {
                    "account": "Assets:CN:Bank",
                    "units": {"number": "-5021.20", "currency": "USD"},
                },
            ],
        },
        1,
    )
    assert "10 GOOG {502.12 USD}" in render_transaction(txn)


def test_render_total_cost():
    txn = validate_transaction(
        {
            "date": "2026-01-03",
            "narration": "buy",
            "postings": [
                {
                    "account": "Assets:Broker",
                    "units": {"number": "10", "currency": "GOOG"},
                    "cost": {"kind": "total", "number": "5021.20", "currency": "USD"},
                },
                {
                    "account": "Assets:CN:Bank",
                    "units": {"number": "-5021.20", "currency": "USD"},
                },
            ],
        },
        1,
    )
    assert "10 GOOG {{5021.20 USD}}" in render_transaction(txn)


def test_render_compound_cost():
    txn = validate_transaction(
        {
            "date": "2026-01-03",
            "narration": "buy",
            "postings": [
                {
                    "account": "Assets:Broker",
                    "units": {"number": "10", "currency": "GOOG"},
                    "cost": {
                        "kind": "compound",
                        "per_number": "502.12",
                        "total_number": "9.95",
                        "currency": "USD",
                    },
                },
                {
                    "account": "Assets:CN:Bank",
                    "units": {"number": "-5021.20", "currency": "USD"},
                },
            ],
        },
        1,
    )
    assert "10 GOOG {502.12 # 9.95 USD}" in render_transaction(txn)


def test_render_prices():
    per_unit = validate_transaction(
        {
            "date": "2026-01-03",
            "narration": "fx",
            "postings": [
                {
                    "account": "Assets:Broker",
                    "units": {"number": "1000", "currency": "USD"},
                    "price": {"kind": "per_unit", "number": "1.10", "currency": "CAD"},
                },
                {
                    "account": "Assets:CN:Bank",
                    "units": {"number": "-1100", "currency": "CAD"},
                },
            ],
        },
        1,
    )
    assert "1000 USD @ 1.10 CAD" in render_transaction(per_unit)

    total = validate_transaction(
        {
            "date": "2026-01-03",
            "narration": "fx",
            "postings": [
                {
                    "account": "Assets:Broker",
                    "units": {"number": "1000", "currency": "USD"},
                    "price": {"kind": "total", "number": "1100", "currency": "CAD"},
                },
                {
                    "account": "Assets:CN:Bank",
                    "units": {"number": "-1100", "currency": "CAD"},
                },
            ],
        },
        1,
    )
    assert "1000 USD @@ 1100 CAD" in render_transaction(total)


def test_render_lot_date_flag_and_metadata():
    txn = validate_transaction(
        {
            "date": "2026-01-03",
            "narration": "sell",
            "payee": "Broker",
            "tags": ["stock", "sale"],
            "links": ["L1"],
            "metadata": {"note": "收益确认", "priority": 1},
            "postings": [
                {
                    "account": "Assets:Broker",
                    "units": {"number": "-10", "currency": "GOOG"},
                    "cost": {
                        "kind": "per_unit",
                        "number": "502.12",
                        "currency": "USD",
                        "date": "2014-05-12",
                    },
                    "price": {"kind": "per_unit", "number": "510", "currency": "USD"},
                },
                {
                    "account": "Assets:CN:Bank",
                    "units": {"number": "5100", "currency": "USD"},
                    "flag": "P",
                    "metadata": {"ref": "abc"},
                },
            ],
        },
        1,
    )
    rendered = render_transaction(txn)
    assert "10 GOOG {502.12 USD, 2014-05-12} @ 510 USD" in rendered
    assert "#stock" in rendered
    assert "^L1" in rendered
    assert "P Assets:CN:Bank" in rendered
    assert 'note: "收益确认"' in rendered
    assert 'ref: "abc"' in rendered


def test_render_all_directives():
    expected = {
        "open": "2026-01-01 open Assets:New CNY,USD STRICT",
        "commodity": "2026-01-01 commodity AAPL",
        "price": "2026-01-01 price AAPL 150.00 USD",
        "balance": "2026-01-02 balance Assets:CN:Bank 500.00 CNY",
        "note": '2026-01-02 note Assets:CN:Bank "hello"',
        "event": '2026-01-01 event "location" "Beijing"',
    }
    samples = {
        "open": {
            "kind": "open",
            "date": "2026-01-01",
            "account": "Assets:New",
            "currencies": ["CNY", "USD"],
            "booking": "STRICT",
        },
        "commodity": {"kind": "commodity", "date": "2026-01-01", "currency": "AAPL"},
        "price": {
            "kind": "price",
            "date": "2026-01-01",
            "commodity": "AAPL",
            "amount": {"number": "150.00", "currency": "USD"},
        },
        "balance": {
            "kind": "balance",
            "date": "2026-01-02",
            "account": "Assets:CN:Bank",
            "amount": {"number": "500.00", "currency": "CNY"},
        },
        "note": {
            "kind": "note",
            "date": "2026-01-02",
            "account": "Assets:CN:Bank",
            "comment": "hello",
        },
        "event": {
            "kind": "event",
            "date": "2026-01-01",
            "type": "location",
            "description": "Beijing",
        },
    }
    for kind, source in samples.items():
        assert render_directive(validate_directive(source, 1)) == expected[kind]


def test_validation_rejects_control_characters():
    with pytest.raises(EntryError, match="控制字符"):
        validate_transaction(
            {
                "date": "2026-01-02",
                "narration": "a\nb",
                "postings": [
                    {
                        "account": "Expenses:Food",
                        "units": {"number": "1", "currency": "CNY"},
                    },
                    {
                        "account": "Assets:CN:Bank",
                        "units": {"number": "-1", "currency": "CNY"},
                    },
                ],
            },
            1,
        )
    with pytest.raises(EntryError, match="控制字符"):
        validate_directive(
            {
                "kind": "note",
                "date": "2026-01-02",
                "account": "Assets:CN:Bank",
                "comment": "x\ry",
            },
            1,
        )


# ---------------------------------------------------------------------------
# schema validation
# ---------------------------------------------------------------------------


def test_signed_units_and_single_interpolation():
    txn = validate_transaction(
        {
            "date": "2026-01-02",
            "narration": "bal",
            "postings": [
                {
                    "account": "Expenses:Food",
                    "units": {"number": "-50", "currency": "CNY"},
                },
                {"account": "Assets:CN:Bank"},
            ],
        },
        1,
    )
    assert txn["postings"][0]["units"]["number"] == "-50"
    assert txn["postings"][1]["units"] is None


def test_multiple_interpolation_rejected():
    with pytest.raises(EntryError, match="无法插值"):
        validate_transaction(
            {
                "date": "2026-01-02",
                "narration": "x",
                "postings": [
                    {"account": "Expenses:Food"},
                    {"account": "Assets:CN:Bank"},
                ],
            },
            1,
        )


def test_missing_units_with_cost_rejected():
    with pytest.raises(EntryError, match="缺少 units"):
        validate_transaction(
            {
                "date": "2026-01-02",
                "narration": "x",
                "postings": [
                    {
                        "account": "Assets:Broker",
                        "cost": {"kind": "per_unit", "number": "1", "currency": "USD"},
                    },
                    {
                        "account": "Assets:CN:Bank",
                        "units": {"number": "-1", "currency": "USD"},
                    },
                ],
            },
            1,
        )


def test_bad_metadata_types_rejected():
    with pytest.raises(EntryError, match="不受支持"):
        validate_transaction(
            {
                "date": "2026-01-02",
                "narration": "x",
                "metadata": {"bad": {"nested": 1}},
                "postings": [
                    {
                        "account": "Expenses:Food",
                        "units": {"number": "1", "currency": "CNY"},
                    },
                    {
                        "account": "Assets:CN:Bank",
                        "units": {"number": "-1", "currency": "CNY"},
                    },
                ],
            },
            1,
        )


# ---------------------------------------------------------------------------
# change-set flows against a real ledger
# ---------------------------------------------------------------------------


def test_simple_import_writes_canonical_source(ledger):
    real_ledger, main, sub = ledger
    store = ChangeSetStore()
    cs = store.update(
        "s1", "transactions", {"transactions": [simple_txn()]}, real_ledger
    )
    assert cs.errors == []
    assert cs.revision == 1

    result = confirm_change_set(real_ledger, store, "s1", cs.revision, None)
    assert result["inserted"] == 1
    written = main.read_text() + sub.read_text()
    assert '2026-01-02 * "" "lunch"' in written
    assert "Expenses:Food  50.00 CNY" in written


def test_foreign_exchange_conversion(ledger):
    real_ledger, _, _ = ledger
    store = ChangeSetStore()
    txn = {
        "date": "2026-01-05",
        "narration": "换汇",
        "postings": [
            {
                "account": "Assets:Broker",
                "units": {"number": "1000", "currency": "USD"},
                "price": {"kind": "per_unit", "number": "7.20", "currency": "CNY"},
            },
            {
                "account": "Assets:CN:Bank",
                "units": {"number": "-7200", "currency": "CNY"},
            },
        ],
    }
    cs = store.update("s1", "transactions", {"transactions": [txn]}, real_ledger)
    assert cs.errors == []


def test_security_purchase_with_cost(ledger):
    real_ledger, _, _ = ledger
    store = ChangeSetStore()
    txn = {
        "date": "2026-01-05",
        "narration": "买入 GOOG",
        "postings": [
            {
                "account": "Assets:Broker",
                "units": {"number": "10", "currency": "GOOG"},
                "cost": {"kind": "per_unit", "number": "100.00", "currency": "USD"},
            },
            {
                "account": "Assets:CN:Bank",
                "units": {"number": "-1000.00", "currency": "USD"},
            },
        ],
    }
    cs = store.update("s1", "transactions", {"transactions": [txn]}, real_ledger)
    assert cs.errors == []


def test_security_sale_with_fees_and_capital_gain(ledger):
    real_ledger, _, _ = ledger
    store = ChangeSetStore()
    cs = store.update(
        "s1",
        "transactions",
        {
            "transactions": [
                {
                    "date": "2026-01-05",
                    "narration": "买入",
                    "postings": [
                        {
                            "account": "Assets:Broker",
                            "units": {"number": "10", "currency": "GOOG"},
                            "cost": {
                                "kind": "per_unit",
                                "number": "100.00",
                                "currency": "USD",
                            },
                        },
                        {
                            "account": "Assets:CN:Bank",
                            "units": {"number": "-1000.00", "currency": "USD"},
                        },
                    ],
                },
                {
                    "date": "2026-01-10",
                    "narration": "卖出",
                    "postings": [
                        {
                            "account": "Assets:Broker",
                            "units": {"number": "-10", "currency": "GOOG"},
                            "cost": {
                                "kind": "per_unit",
                                "number": "100.00",
                                "currency": "USD",
                            },
                            "price": {
                                "kind": "per_unit",
                                "number": "120.00",
                                "currency": "USD",
                            },
                        },
                        {
                            "account": "Expenses:Broker:Fees",
                            "units": {"number": "10.00", "currency": "USD"},
                        },
                        {
                            "account": "Income:CapitalGains",
                            "units": {"number": "-200.00", "currency": "USD"},
                        },
                        {
                            "account": "Assets:CN:Bank",
                            "units": {"number": "1190.00", "currency": "USD"},
                        },
                    ],
                },
            ]
        },
        real_ledger,
    )
    assert cs.errors == []
    assert len(cs.transactions) == 2


def test_complete_batch_replacement(ledger):
    real_ledger, _, _ = ledger
    store = ChangeSetStore()
    store.update("s1", "transactions", {"transactions": [simple_txn()]}, real_ledger)
    cs1 = store.get("s1")
    assert len(cs1.transactions) == 1

    # A retry replaces the whole batch instead of appending duplicates.
    cs2 = store.update(
        "s1",
        "transactions",
        {
            "transactions": [
                simple_txn(narration="dinner"),
                simple_txn(narration="snack"),
            ]
        },
        real_ledger,
    )
    assert cs2.revision == 2
    assert len(cs2.transactions) == 2
    assert [t["narration"] for t in cs2.transactions] == ["dinner", "snack"]


def test_open_plus_transaction_validates_as_one_set(ledger):
    real_ledger, _, _ = ledger
    store = ChangeSetStore()
    txn = {
        "date": "2026-01-02",
        "narration": "invest",
        "postings": [
            {"account": "Assets:Invest", "units": {"number": "100", "currency": "CNY"}},
            {
                "account": "Assets:CN:Bank",
                "units": {"number": "-100", "currency": "CNY"},
            },
        ],
    }
    # The transaction alone fails clearly.
    with pytest.raises(EntryError, match="Assets:Invest"):
        store.update("s1", "transactions", {"transactions": [txn]}, real_ledger)

    # Adding the open directive makes the combined change set valid.
    cs = store.update(
        "s1",
        "directives",
        {
            "directives": [
                {
                    "kind": "open",
                    "date": "2026-01-01",
                    "account": "Assets:Invest",
                    "currencies": ["CNY"],
                }
            ]
        },
        real_ledger,
    )
    assert cs.errors == []
    assert "open Assets:Invest" in cs.preview


def test_excluded_directives_rejected(ledger):
    real_ledger, _, _ = ledger
    store = ChangeSetStore()
    for kind in (
        "option",
        "include",
        "plugin",
        "pushtag",
        "poptag",
        "close",
        "pad",
        "document",
    ):
        with pytest.raises(EntryError, match="不支持的指令类型"):
            store.update(
                "s1",
                "directives",
                {"directives": [{"kind": kind, "date": "2026-01-01"}]},
                real_ledger,
            )


def test_directives_render_validate_and_write(ledger):
    real_ledger, _, sub = ledger
    store = ChangeSetStore()
    directives = [
        {
            "kind": "open",
            "date": "2026-01-01",
            "account": "Assets:New",
            "currencies": ["CNY"],
        },
        {"kind": "commodity", "date": "2026-01-01", "currency": "AAPL"},
        {
            "kind": "price",
            "date": "2026-01-01",
            "commodity": "AAPL",
            "amount": {"number": "150.00", "currency": "USD"},
        },
        {
            "kind": "balance",
            "date": "2026-01-02",
            "account": "Assets:CN:Bank",
            "amount": {"number": "0.00", "currency": "CNY"},
        },
        {
            "kind": "note",
            "date": "2026-01-02",
            "account": "Assets:CN:Bank",
            "comment": "hello",
        },
        {
            "kind": "event",
            "date": "2026-01-01",
            "type": "location",
            "description": "Beijing",
        },
    ]
    cs = store.update("s1", "directives", {"directives": directives}, real_ledger)
    assert cs.errors == []
    result = confirm_change_set(real_ledger, store, "s1", cs.revision, "2026.beancount")
    assert result["inserted"] == 6
    written = sub.read_text()
    assert "open Assets:New" in written
    assert "commodity AAPL" in written
    assert "price AAPL 150.00 USD" in written
    assert 'note Assets:CN:Bank "hello"' in written


def test_balance_assertion_failure_blocks_proposal(ledger):
    real_ledger, _, _ = ledger
    store = ChangeSetStore()
    with pytest.raises(EntryError, match="校验失败"):
        store.update(
            "s1",
            "directives",
            {
                "directives": [
                    {
                        "kind": "balance",
                        "date": "2026-01-02",
                        "account": "Assets:CN:Bank",
                        "amount": {"number": "999.00", "currency": "CNY"},
                    }
                ]
            },
            real_ledger,
        )


def test_stale_source_checksum_blocks_confirmation(ledger):
    real_ledger, main, _ = ledger
    store = ChangeSetStore()
    store.update("s1", "transactions", {"transactions": [simple_txn()]}, real_ledger)
    cs = store.get("s1")
    # The target file changes after validation.
    main.write_text(main.read_text() + "; user edit\n")
    with pytest.raises(EntryError, match="源文件已被修改"):
        confirm_change_set(real_ledger, store, "s1", cs.revision, None)


def test_revision_mismatch_blocks_confirmation(ledger):
    real_ledger, _, _ = ledger
    store = ChangeSetStore()
    store.update("s1", "transactions", {"transactions": [simple_txn()]}, real_ledger)
    with pytest.raises(EntryError, match="重新确认"):
        confirm_change_set(real_ledger, store, "s1", 999, None)


def test_invalid_lot_reduction_blocks_proposal(ledger):
    real_ledger, main, sub = ledger
    # The lot must exist in the ledger before a reduction can be matched.
    sub.write_text(
        sub.read_text()
        + '\n2026-01-05 * "买入"\n  Assets:Broker 10 GOOG {100.00 USD}\n  Assets:CN:Bank -1000.00 USD\n'
    )
    from fava.core import FavaLedger

    real_ledger = FavaLedger(str(main))
    store = ChangeSetStore()
    # Sell against a lot that never existed: booking must reject it.
    with pytest.raises(EntryError, match="校验失败"):
        store.update(
            "s1",
            "transactions",
            {
                "transactions": [
                    {
                        "date": "2026-01-10",
                        "narration": "卖出",
                        "postings": [
                            {
                                "account": "Assets:Broker",
                                "units": {"number": "-5", "currency": "GOOG"},
                                "cost": {
                                    "kind": "per_unit",
                                    "number": "999.00",
                                    "currency": "USD",
                                },
                            },
                            {
                                "account": "Assets:CN:Bank",
                                "units": {"number": "4995.00", "currency": "USD"},
                            },
                        ],
                    }
                ]
            },
            real_ledger,
        )


def test_raw_source_cannot_be_smuggled(ledger):
    real_ledger, _, _ = ledger
    store = ChangeSetStore()
    # A narration containing Beancount source is rejected by the renderer
    # round-trip (control characters are blocked outright).
    with pytest.raises(EntryError, match="控制字符"):
        store.update(
            "s1",
            "transactions",
            {
                "transactions": [
                    {
                        "date": "2026-01-02",
                        "narration": "x\n  Assets:CN:Bank -9999.00 CNY",
                        "postings": [
                            {
                                "account": "Expenses:Food",
                                "units": {"number": "1", "currency": "CNY"},
                            },
                            {
                                "account": "Assets:CN:Bank",
                                "units": {"number": "-1", "currency": "CNY"},
                            },
                        ],
                    }
                ]
            },
            real_ledger,
        )
