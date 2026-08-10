"""Short-lived, single-use capability tokens for gated operations.

A capability is minted only after an explicit user approval in the UI and is
bound to the canonical hash of the exact operation being authorized, the
current ledger, and the conversation session.  A write endpoint must consume
the token and independently revalidate the operation before mutating anything;
the token is single-use so one approval never authorizes a later, different
call.

The operation hash is computed **by the backend** from the submitted operation
object, so approval binding never depends on the frontend computing the same
hash.  Any mismatch between the approved and the submitted operation is
rejected at consume time.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

# Risk classes ordered from least to most sensitive.  The first
# implementation only needs read/propose/write policies, but the ordering
# keeps room for a future ``destructive`` policy without weakening ``write``.
RISK_ORDER = {"read": 0, "propose": 1, "write": 2, "destructive": 3}
MINTABLE_RISKS = frozenset({"write", "destructive"})

DEFAULT_TTL_SECONDS = 120.0


class CapabilityError(ValueError):
    """Raised when a capability cannot be minted or consumed."""


@dataclass(frozen=True)
class Capability:
    """An approved, still-unconsumed operation grant."""

    token: str
    operation_hash: str
    ledger_id: str
    session_id: str
    risk: str
    expires_at: float
    consumed: bool = False


def canonical_operation_hash(operation: Any) -> str:
    """Hash an operation deterministically (JSON key order does not matter)."""
    payload = json.dumps(
        operation,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class CapabilityStore:
    """In-memory, thread-safe capability store for one extension instance."""

    def __init__(
        self,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl = ttl_seconds
        self._clock = clock
        self._lock = threading.RLock()
        self._capabilities: dict[str, Capability] = {}

    def mint(
        self,
        operation: Any,
        ledger_id: str,
        session_id: str = "",
        risk: str = "write",
    ) -> dict[str, Any]:
        """Create a capability for an operation after user approval."""
        risk = risk.strip().lower()
        if risk not in MINTABLE_RISKS:
            allowed = ", ".join(sorted(MINTABLE_RISKS))
            msg = f"不允许的能力风险等级：{risk!r}（可用：{allowed}）"
            raise CapabilityError(msg)
        if not ledger_id:
            msg = "缺少账本标识，无法签发能力令牌"
            raise CapabilityError(msg)
        if operation is None:
            msg = "缺少操作内容，无法签发能力令牌"
            raise CapabilityError(msg)
        capability = Capability(
            token=secrets.token_urlsafe(32),
            operation_hash=canonical_operation_hash(operation),
            ledger_id=str(ledger_id),
            session_id=str(session_id or ""),
            risk=risk,
            expires_at=self._clock() + self._ttl,
        )
        with self._lock:
            self._prune()
            self._capabilities[capability.token] = capability
        return self._grant(capability)

    def consume(
        self,
        token: str,
        operation: Any,
        ledger_id: str,
        session_id: str = "",
        min_risk: str = "write",
    ) -> Capability:
        """Atomically verify and consume a capability for an operation.

        Any failed consume invalidates the token as well, so a mismatched
        operation can never be probed into a valid grant.

        Raises:
            CapabilityError: If the token is missing, expired, already used,
                bound to a different operation, ledger, or session, or too
                weak for the requested risk class.
        """
        expected_risk = min_risk.strip().lower()
        if expected_risk not in RISK_ORDER:
            msg = f"未知的风险等级：{min_risk!r}"
            raise CapabilityError(msg)
        operation_hash = canonical_operation_hash(operation)
        with self._lock:
            capability = self._capabilities.get(token)
            if capability is None:
                msg = "能力令牌不存在或已被使用"
                raise CapabilityError(msg)
            if capability.consumed:
                self._capabilities.pop(token, None)
                msg = "能力令牌不存在或已被使用"
                raise CapabilityError(msg)
            if capability.expires_at < self._clock():
                self._capabilities.pop(token, None)
                msg = "能力令牌已过期"
                raise CapabilityError(msg)
            if capability.operation_hash != operation_hash:
                self._capabilities.pop(token, None)
                msg = "操作内容与已批准的操作不匹配"
                raise CapabilityError(msg)
            if capability.ledger_id != str(ledger_id):
                self._capabilities.pop(token, None)
                msg = "能力令牌不属于当前账本"
                raise CapabilityError(msg)
            if capability.session_id != str(session_id or ""):
                self._capabilities.pop(token, None)
                msg = "能力令牌不属于当前会话"
                raise CapabilityError(msg)
            if RISK_ORDER[capability.risk] < RISK_ORDER[expected_risk]:
                self._capabilities.pop(token, None)
                msg = f"能力等级不足：需要 {expected_risk}，令牌为 {capability.risk}"
                raise CapabilityError(msg)
            consumed = Capability(
                token=capability.token,
                operation_hash=capability.operation_hash,
                ledger_id=capability.ledger_id,
                session_id=capability.session_id,
                risk=capability.risk,
                expires_at=capability.expires_at,
                consumed=True,
            )
            self._capabilities[token] = consumed
            return consumed

    def _grant(self, capability: Capability) -> dict[str, Any]:
        """Frontend-facing serialization of a minted grant.

        Internal expiry is tracked on the monotonic clock; the frontend
        compares against ``Date.now()``, so ``expires_at`` is converted to
        epoch seconds here.
        """
        remaining = max(0.0, capability.expires_at - self._clock())
        return {
            "capability": capability.token,
            "operation_hash": capability.operation_hash,
            "risk": capability.risk,
            "expires_at": time.time() + remaining,
        }

    def _prune(self) -> None:
        now = self._clock()
        expired = [
            token
            for token, capability in self._capabilities.items()
            if capability.expires_at < now
        ]
        for token in expired:
            self._capabilities.pop(token, None)


def require_capability(
    store: CapabilityStore,
    token: str,
    operation: Any,
    ledger_id: str,
    session_id: str = "",
    min_risk: str = "write",
) -> Capability:
    """Consume a required capability, raising a clear error when absent.

    Write endpoints call this first thing: without a valid capability the
    mutation is rejected even if the frontend approval checks were bypassed.
    """
    if not token or not token.strip():
        msg = "缺少授权凭证，操作已被拒绝"
        raise CapabilityError(msg)
    return store.consume(
        token.strip(),
        operation=operation,
        ledger_id=ledger_id,
        session_id=session_id,
        min_risk=min_risk,
    )
