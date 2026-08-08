"""Tests for single-use capability tokens."""

from __future__ import annotations

import threading

import pytest

from favai.capabilities import (
    CapabilityError,
    CapabilityStore,
    canonical_operation_hash,
    require_capability,
)

LEDGER = "/ledgers/example.beancount"
OP_A = {
    "path": "sub/2026.beancount",
    "initial_content": "2026-01-01 open Assets:Cash",
    "include_in_main": True,
}
OP_B = {"path": "other.beancount", "initial_content": "", "include_in_main": False}


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def make_store(ttl: float = 120.0) -> tuple[CapabilityStore, FakeClock]:
    clock = FakeClock()
    return CapabilityStore(ttl_seconds=ttl, clock=clock), clock


def test_mint_returns_token_and_expiry() -> None:
    store, clock = make_store()
    grant = store.mint(operation=OP_A, ledger_id=LEDGER, session_id="s1")

    token = str(grant["capability"])
    assert len(token) >= 32
    assert grant["expires_at"] == pytest.approx(clock.now + 120.0)
    assert grant["operation_hash"] == canonical_operation_hash(OP_A)


def test_canonical_hash_ignores_key_order() -> None:
    assert canonical_operation_hash({"a": 1, "b": 2}) == canonical_operation_hash(
        {"b": 2, "a": 1}
    )


def test_consume_accepts_exact_match() -> None:
    store, _ = make_store()
    token = str(
        store.mint(operation=OP_A, ledger_id=LEDGER, session_id="s1")["capability"]
    )

    capability = store.consume(token, operation=OP_A, ledger_id=LEDGER, session_id="s1")
    assert capability.consumed is True


def test_replay_fails_after_first_consume() -> None:
    store, _ = make_store()
    token = str(store.mint(operation=OP_A, ledger_id=LEDGER)["capability"])
    store.consume(token, operation=OP_A, ledger_id=LEDGER)

    with pytest.raises(CapabilityError, match="不存在或已被使用"):
        store.consume(token, operation=OP_A, ledger_id=LEDGER)


def test_expired_token_fails() -> None:
    store, clock = make_store(ttl=60.0)
    token = str(store.mint(operation=OP_A, ledger_id=LEDGER)["capability"])
    clock.now += 61.0

    with pytest.raises(CapabilityError, match="已过期"):
        store.consume(token, operation=OP_A, ledger_id=LEDGER)


def test_expired_token_is_removed_not_retryable() -> None:
    store, clock = make_store(ttl=60.0)
    token = str(store.mint(operation=OP_A, ledger_id=LEDGER)["capability"])
    clock.now += 61.0
    with pytest.raises(CapabilityError):
        store.consume(token, operation=OP_A, ledger_id=LEDGER)

    clock.now -= 61.0  # even if the clock went backwards, the token is gone
    with pytest.raises(CapabilityError, match="不存在或已被使用"):
        store.consume(token, operation=OP_A, ledger_id=LEDGER)


def test_argument_change_invalidates_token() -> None:
    store, _ = make_store()
    token = str(store.mint(operation=OP_A, ledger_id=LEDGER)["capability"])

    with pytest.raises(CapabilityError, match="不匹配"):
        store.consume(token, operation=OP_B, ledger_id=LEDGER)


def test_ledger_mismatch_invalidates_token() -> None:
    store, _ = make_store()
    token = str(store.mint(operation=OP_A, ledger_id=LEDGER)["capability"])

    with pytest.raises(CapabilityError, match="不属于当前账本"):
        store.consume(token, operation=OP_A, ledger_id="/ledgers/other.beancount")


def test_session_mismatch_invalidates_token() -> None:
    store, _ = make_store()
    token = str(
        store.mint(operation=OP_A, ledger_id=LEDGER, session_id="s1")["capability"]
    )

    with pytest.raises(CapabilityError, match="不属于当前会话"):
        store.consume(token, operation=OP_A, ledger_id=LEDGER, session_id="s2")


def test_failed_consume_invalidates_token_too() -> None:
    """A token consumed with wrong arguments cannot be retried correctly."""
    store, _ = make_store()
    token = str(store.mint(operation=OP_A, ledger_id=LEDGER)["capability"])
    with pytest.raises(CapabilityError):
        store.consume(token, operation=OP_B, ledger_id=LEDGER)

    with pytest.raises(CapabilityError, match="不存在或已被使用"):
        store.consume(token, operation=OP_A, ledger_id=LEDGER)


def test_unknown_token_fails() -> None:
    store, _ = make_store()
    with pytest.raises(CapabilityError):
        store.consume("not-a-token", operation=OP_A, ledger_id=LEDGER)


def test_require_capability_rejects_blank_token() -> None:
    store, _ = make_store()
    with pytest.raises(CapabilityError, match="缺少授权凭证"):
        require_capability(store, "", operation=OP_A, ledger_id=LEDGER)


def test_require_capability_consumes() -> None:
    store, _ = make_store()
    token = str(store.mint(operation=OP_A, ledger_id=LEDGER)["capability"])
    require_capability(store, token, operation=OP_A, ledger_id=LEDGER)
    with pytest.raises(CapabilityError):
        require_capability(store, token, operation=OP_A, ledger_id=LEDGER)


def test_mint_requires_operation_and_ledger() -> None:
    store, _ = make_store()
    with pytest.raises(CapabilityError):
        store.mint(operation=None, ledger_id=LEDGER)
    with pytest.raises(CapabilityError):
        store.mint(operation=OP_A, ledger_id="")


def test_mint_rejects_unknown_risk() -> None:
    store, _ = make_store()
    with pytest.raises(CapabilityError):
        store.mint(operation=OP_A, ledger_id=LEDGER, risk="read")
    with pytest.raises(CapabilityError):
        store.mint(operation=OP_A, ledger_id=LEDGER, risk="arbitrary")


def test_consume_enforces_min_risk() -> None:
    store, _ = make_store()
    token = str(
        store.mint(operation=OP_A, ledger_id=LEDGER, risk="write")["capability"]
    )
    with pytest.raises(CapabilityError, match="能力等级不足"):
        store.consume(token, operation=OP_A, ledger_id=LEDGER, min_risk="destructive")


def test_tokens_are_unique_under_concurrency() -> None:
    """Simultaneous mints for the same operation produce distinct tokens."""
    store, _ = make_store()
    tokens: list[str] = []

    def mint() -> None:
        grant = store.mint(operation=OP_A, ledger_id=LEDGER)
        tokens.append(str(grant["capability"]))

    threads = [threading.Thread(target=mint) for _ in range(16)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(tokens) == 16
    assert len(set(tokens)) == 16


def test_concurrent_consume_only_one_wins() -> None:
    store, _ = make_store()
    token = str(store.mint(operation=OP_A, ledger_id=LEDGER)["capability"])
    outcomes: list[str] = []

    def consume() -> None:
        try:
            store.consume(token, operation=OP_A, ledger_id=LEDGER)
            outcomes.append("ok")
        except CapabilityError:
            outcomes.append("error")

    threads = [threading.Thread(target=consume) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert outcomes.count("ok") == 1
    assert outcomes.count("error") == 7
