"""Tests for favai.entries."""

from __future__ import annotations

import pytest

from favai.entries import (
    EntryError,
    resolve_source_file,
    source_file_options,
    to_fava_entries,
    to_fava_entry,
    write_entries,
)

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


def test_tags_are_normalised():
    entry = to_fava_entry({**VALID, "tags": ["food", "#reimbursable"]})
    assert entry["tags"] == ["food", "reimbursable"]


@pytest.mark.parametrize("tag", ["", "#", "bad tag", "中文", "foo:bar"])
def test_invalid_tag(tag):
    with pytest.raises(EntryError, match="标签格式无效"):
        to_fava_entry({**VALID, "tags": [tag]})


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


class _FakeFile:
    def __init__(self, path):
        self.path = path
        self.written = None

    def get_source(self, path):
        assert path == self.path
        return self.path.read_text(), "checksum"

    def render_entries(self, entries):
        return iter(entries)

    def set_source(self, path, source, checksum):
        assert path == self.path
        assert checksum == "checksum"
        self.written = source

    def insert_entries(self, entries):
        raise AssertionError("explicit writes must not use default routing")


class _FakeOptions:
    default_file = None


class _FakeLedger:
    def __init__(self, main, included):
        self.beancount_file_path = str(main)
        self.options = {"include": [str(main), str(included)]}
        self.fava_options = _FakeOptions()
        self.file = _FakeFile(included)


def test_source_file_options_and_explicit_write(tmp_path):
    main = tmp_path / "main.beancount"
    included = tmp_path / "2026-07.beancount"
    main.write_text('include "2026-07.beancount"\n')
    included.write_text("; July\n")
    ledger = _FakeLedger(main, included)

    assert source_file_options(ledger) == (
        ["2026-07.beancount", "main.beancount"],
        "main.beancount",
    )
    assert resolve_source_file(ledger, "2026-07.beancount") == included

    write_entries(ledger, ['2026-07-20 * "Lunch"\n'], "2026-07.beancount")
    assert ledger.file.written == '; July\n\n2026-07-20 * "Lunch"\n'


def test_source_file_rejects_non_ledger_file(tmp_path):
    main = tmp_path / "main.beancount"
    included = tmp_path / "included.beancount"
    other = tmp_path / "other.beancount"
    for path in (main, included, other):
        path.write_text("")
    ledger = _FakeLedger(main, included)

    with pytest.raises(EntryError, match="不是当前账本的源文件"):
        resolve_source_file(ledger, "other.beancount")


def test_explicit_write_with_fava_ledger(tmp_path):
    from fava.core import FavaLedger
    from fava.serialisation import deserialise

    main = tmp_path / "main.beancount"
    monthly = tmp_path / "2026-07.beancount"
    main.write_text('include "2026-07.beancount"\n')
    monthly.write_text("")
    ledger = FavaLedger(str(main))
    entry = deserialise(to_fava_entry({**VALID, "tags": ["#food"]}))

    write_entries(ledger, [entry], "2026-07.beancount")

    assert "聚餐" not in main.read_text()
    assert "#food" in monthly.read_text()
    assert '"海底捞" "聚餐"' in monthly.read_text()
