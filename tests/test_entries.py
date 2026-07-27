"""Tests for favai.entries."""

from __future__ import annotations

import pytest

from favai.entries import EntryError, to_fava_entries, to_fava_entry

VALID = {
    "date": "2026-07-20",
    "payee": "海底捞",
    "narration": "聚餐",
    "postings": [
        {"account": "Expenses:Food:Restaurant", "amount": "268.00"},
        {"account": "Assets:CN:Alipay"},
    ],
}


def test_to_fava_entry_shape():
    entry = to_fava_entry(VALID, "CNY")
    assert entry["t"] == "Transaction"
    assert entry["date"] == "2026-07-20"
    assert entry["payee"] == "海底捞"
    assert entry["postings"][0] == {
        "account": "Expenses:Food:Restaurant",
        "amount": "268.00 CNY",
    }
    assert entry["postings"][1] == {
        "account": "Assets:CN:Alipay",
        "amount": "",
    }


def test_explicit_currency():
    txn = {
        "date": "2026-07-20",
        "narration": "x",
        "postings": [
            {"account": "A:B", "amount": "10", "currency": "USD"},
            {"account": "C:D"},
        ],
    }
    entry = to_fava_entry(txn, "CNY")
    assert entry["postings"][0]["amount"] == "10 USD"


@pytest.mark.parametrize(
    ("txn", "match"),
    [
        ({**VALID, "date": "2026/07/20"}, "日期格式无效"),
        ({**VALID, "postings": [{"account": "A:B", "amount": "1"}]}, "至少需要两条"),
        (
            {
                **VALID,
                "postings": [{"account": "A:B"}, {"account": "C:D"}],
            },
            "多条 postings 缺少金额",
        ),
        (
            {
                **VALID,
                "postings": [
                    {"account": "A:B", "amount": "abc"},
                    {"account": "C:D"},
                ],
            },
            "金额格式无效",
        ),
        ({**VALID, "postings": [{"amount": "1"}, {"account": "C:D"}]}, "缺少 account"),
    ],
)
def test_invalid_transactions(txn, match):
    with pytest.raises(EntryError, match=match):
        to_fava_entry(txn)


def test_to_fava_entries_empty():
    with pytest.raises(EntryError, match="没有可写入的交易"):
        to_fava_entries([])
