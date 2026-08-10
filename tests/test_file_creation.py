"""Tests for the gated create-and-include ledger file capability."""

from __future__ import annotations

import pathlib

import pytest

from favai.capabilities import CapabilityError, CapabilityStore
from favai.entries import EntryError
from favai.file_creation import (
    create_and_include,
    create_and_include_gated,
)

LEDGER_SOURCE = """option "operating_currency" "CNY"

2026-01-01 open Assets:CN:Bank CNY
"""


@pytest.fixture
def ledger(tmp_path: pathlib.Path):
    from fava.core import FavaLedger

    main = tmp_path / "main.beancount"
    main.write_text(LEDGER_SOURCE)
    return FavaLedger(str(main)), main, tmp_path


def operation(path: str, content: str = "", include: bool = True) -> dict:
    return {
        "path": path,
        "initial_content": content,
        "include_in_main": include,
    }


def test_nested_relative_path_created_and_included(ledger):
    real_ledger, main, root = ledger
    result = create_and_include(
        real_ledger, operation("sub/2026/2026-01.beancount", "; January 2026")
    )
    assert result["created_path"] == "sub/2026/2026-01.beancount"
    assert result["already_completed"] is False
    assert (root / "sub/2026/2026-01.beancount").read_text() == "; January 2026\n"
    assert 'include "sub/2026/2026-01.beancount"' in main.read_text()

    # The combined ledger still loads through Fava.
    from fava.core import FavaLedger

    reloaded = FavaLedger(str(main))
    assert len(reloaded.all_entries) >= 1


def test_rejects_absolute_and_traversal_paths(ledger):
    real_ledger, _, _ = ledger
    for bad in ["/etc/x.beancount", "../escape.beancount", "a/../../x.beancount"]:
        with pytest.raises(EntryError):
            create_and_include(real_ledger, operation(bad))


def test_rejects_glob_and_unsafe_components(ledger):
    real_ledger, _, _ = ledger
    for bad in ["*.beancount", "a?b.beancount", "x:{}.beancount", "a\\b.beancount"]:
        with pytest.raises(EntryError):
            create_and_include(real_ledger, operation(bad))


def test_rejects_non_beancount_suffix(ledger):
    real_ledger, _, _ = ledger
    with pytest.raises(EntryError, match=".beancount"):
        create_and_include(real_ledger, operation("notes.txt"))


def test_rejects_symlink_escape(ledger, tmp_path: pathlib.Path):
    real_ledger, _, root = ledger
    outside = tmp_path / "outside"
    outside.mkdir()
    link = root / "linked"
    link.symlink_to(outside, target_is_directory=True)
    with pytest.raises(EntryError, match="符号链接"):
        create_and_include(real_ledger, operation("linked/x.beancount"))


def test_rejects_existing_file_with_different_content(ledger):
    real_ledger, _, root = ledger
    target = root / "existing.beancount"
    target.write_text("; user data\n")
    with pytest.raises(EntryError, match="拒绝覆盖"):
        create_and_include(real_ledger, operation("existing.beancount", "; agent"))


def test_rejects_invalid_beancount_syntax(ledger):
    real_ledger, _, _ = ledger
    with pytest.raises(EntryError, match="语法检查"):
        create_and_include(
            real_ledger, operation("bad.beancount", "this is not beancount")
        )


def test_rejects_oversized_payload(ledger):
    real_ledger, _, _ = ledger
    big = "x" * (101 * 1024)
    with pytest.raises(EntryError, match="过大"):
        create_and_include(real_ledger, operation("big.beancount", big))


def test_rejects_duplicate_include(ledger):
    real_ledger, main, _ = ledger
    create_and_include(real_ledger, operation("once.beancount", "; once"))
    # Already-completed identical operation is idempotent.
    result = create_and_include(real_ledger, operation("once.beancount", "; once"))
    assert result["already_completed"] is True
    assert main.read_text().count('include "once.beancount"') == 1


def test_orphan_recovery_after_include_failure(ledger):
    real_ledger, main, root = ledger

    # Simulate a failure between file creation and include insertion: the
    # file exists with identical content but the include is missing.
    target = root / "orphan.beancount"
    target.write_text("; orphan\n")
    result = create_and_include(real_ledger, operation("orphan.beancount", "; orphan"))
    assert result["already_completed"] is False
    assert 'include "orphan.beancount"' in main.read_text()


def test_requires_include_in_main(ledger):
    real_ledger, _, _ = ledger
    with pytest.raises(EntryError, match="include_in_main"):
        create_and_include(real_ledger, operation("x.beancount", include=False))


def test_gated_endpoint_consumes_capability(ledger):
    real_ledger, main, root = ledger
    store = CapabilityStore()
    op = operation("gated.beancount", "; gated")
    grant = store.mint(operation=op, ledger_id="/ledgers/example", session_id="s1")
    token = str(grant["capability"])

    result = create_and_include_gated(
        real_ledger, store, "/ledgers/example", "s1", token, op
    )
    assert result["already_completed"] is False
    assert (root / "gated.beancount").exists()
    assert 'include "gated.beancount"' in main.read_text()


def test_gated_endpoint_rejects_missing_capability(ledger):
    real_ledger, main, _ = ledger
    store = CapabilityStore()
    with pytest.raises(CapabilityError, match="缺少授权凭证"):
        create_and_include_gated(
            real_ledger, store, "/ledgers/example", "s1", "", operation("x.beancount")
        )
    assert not (main.parent / "x.beancount").exists()


def test_gated_endpoint_rejects_wrong_operation(ledger):
    real_ledger, _, root = ledger
    store = CapabilityStore()
    op = operation("approved.beancount", "; approved")
    token = str(
        store.mint(operation=op, ledger_id="/ledgers/example", session_id="s1")[
            "capability"
        ]
    )
    tampered = operation("approved.beancount", "; DIFFERENT")

    with pytest.raises(CapabilityError, match="不匹配"):
        create_and_include_gated(
            real_ledger, store, "/ledgers/example", "s1", token, tampered
        )
    assert not (root / "approved.beancount").exists()


def test_gated_endpoint_rejects_replay(ledger):
    real_ledger, _, _ = ledger
    store = CapabilityStore()
    op = operation("replay.beancount", "; r")
    token = str(
        store.mint(operation=op, ledger_id="/ledgers/example", session_id="s1")[
            "capability"
        ]
    )

    create_and_include_gated(real_ledger, store, "/ledgers/example", "s1", token, op)
    with pytest.raises(CapabilityError, match="不存在或已被使用"):
        create_and_include_gated(
            real_ledger, store, "/ledgers/example", "s1", token, op
        )


def test_gated_endpoint_rejects_ledger_mismatch(ledger):
    real_ledger, _, root = ledger
    store = CapabilityStore()
    op = operation("mismatch.beancount", "; m")
    token = str(
        store.mint(operation=op, ledger_id="/ledgers/other", session_id="s1")[
            "capability"
        ]
    )

    with pytest.raises(CapabilityError, match="账本"):
        create_and_include_gated(
            real_ledger, store, "/ledgers/example", "s1", token, op
        )
    assert not (root / "mismatch.beancount").exists()
