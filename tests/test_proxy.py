"""Tests for favai.proxy — pure function tests.

``forward_llm`` returns a Flask ``Response`` (via ``stream_with_context``)
which requires a request context, so it is tested via the endpoint integration
tests.  Here we test the internal helper functions in isolation.
"""

from __future__ import annotations

import pytest

from favai.config import ProviderConfig
from favai.proxy import (
    _SAFE_UPSTREAM,
    ProxyError,
    _build_upstream_headers,
    _resolve_key,
)

# ---------------------------------------------------------------------------
# _resolve_key
# ---------------------------------------------------------------------------


def test_resolve_literal_key():
    assert _resolve_key("sk-test") == "sk-test"


def test_resolve_env_var_key(monkeypatch):
    monkeypatch.setenv("MY_KEY", "sk-env-secret")
    assert _resolve_key("$MY_KEY") == "sk-env-secret"


def test_resolve_missing_env_var():
    with pytest.raises(ProxyError, match="环境变量"):
        _resolve_key("$NONEXISTENT_VAR")


# ---------------------------------------------------------------------------
# _SAFE_UPSTREAM regex
#
# The regex only checks that the path starts with "/" and has no spaces.
# The ".." and "://" checks are done separately in forward_llm (not tested
# here).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "valid"),
    [
        ("/chat/completions", True),
        ("/v1/messages", True),
        ("/", True),
        ("/some/path/v1/123?foo=bar", True),
        ("/../etc/passwd", True),  # ".." is caught later, not by the regex
        ("/safe/../../etc", True),  # ".." is caught later, not by the regex
        ("chat/completions", False),
        ("", False),
        ("http://evil.com/x", False),
        ("/with space", False),  # \S excludes space
    ],
)
def test_safe_upstream_regex(path, valid):
    match = _SAFE_UPSTREAM.match(path)
    if valid:
        assert match is not None, f"expected {path!r} to be valid"
    else:
        assert match is None, f"expected {path!r} to be invalid"


# ---------------------------------------------------------------------------
# _build_upstream_headers
# ---------------------------------------------------------------------------


def test_openai_auth_header(monkeypatch):
    monkeypatch.setenv("KEY", "real-key")
    config = ProviderConfig(
        api="openai-completions",
        base_url="https://x.com",
        model="x",
        api_key="$KEY",
    )
    headers = _build_upstream_headers(
        "/test", {"content-type": "application/json"}, config
    )
    assert headers["Authorization"] == "Bearer real-key"


def test_openai_dummy_auth_stripped(monkeypatch):
    monkeypatch.setenv("K", "k")
    config = ProviderConfig(
        api="openai-completions", base_url="https://x.com", model="x", api_key="$K"
    )
    headers = _build_upstream_headers(
        "/test",
        {"authorization": "Bearer dummy", "content-type": "application/json"},
        config,
    )
    # The injected Authorization header is the canonical-cased one — fine
    lower_headers = {k.lower(): v for k, v in headers.items()}
    assert lower_headers.get("authorization") != "Bearer dummy"
    assert lower_headers.get("authorization") == "Bearer k"


def test_anthropic_auth_header(monkeypatch):
    monkeypatch.setenv("KEY", "sk-ant-real")
    config = ProviderConfig(
        api="anthropic-messages",
        base_url="https://x.com",
        model="x",
        api_key="$KEY",
    )
    headers = _build_upstream_headers(
        "/test",
        {
            "x-api-key": "dummy",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        config,
    )
    lower_headers = {k.lower(): v for k, v in headers.items()}
    assert lower_headers.get("x-api-key") == "sk-ant-real"
    assert lower_headers.get("x-api-key") != "dummy"
    assert lower_headers.get("anthropic-version") == "2023-06-01"


def test_anthropic_adds_missing_version(monkeypatch):
    monkeypatch.setenv("KEY", "k")
    config = ProviderConfig(
        api="anthropic-messages",
        base_url="https://x.com",
        model="x",
        api_key="$KEY",
    )
    headers = _build_upstream_headers(
        "/test", {"content-type": "application/json"}, config
    )
    assert headers.get("anthropic-version") == "2023-06-01"


def test_content_type_passthrough(monkeypatch):
    monkeypatch.setenv("K", "k")
    config = ProviderConfig(
        api="openai-completions", base_url="https://x.com", model="x", api_key="$K"
    )
    headers = _build_upstream_headers(
        "/test",
        {"content-type": "application/json", "anthropic-beta": "test-1"},
        config,
    )
    assert headers.get("content-type") == "application/json"
    assert headers.get("anthropic-beta") == "test-1"


def test_hop_by_hop_headers_stripped(monkeypatch):
    monkeypatch.setenv("K", "k")
    config = ProviderConfig(
        api="openai-completions", base_url="https://x.com", model="x", api_key="$K"
    )
    input_headers = {
        "host": "example.com",
        "content-length": "100",
        "connection": "keep-alive",
        "accept-encoding": "gzip",
        "content-type": "application/json",
        "authorization": "Bearer dummy",
    }
    headers = _build_upstream_headers("/test", input_headers, config)
    lower_headers = {k.lower(): v for k, v in headers.items()}
    stripped = {"host", "content-length", "connection", "accept-encoding"}
    for h in stripped:
        assert h not in lower_headers, f"{h} should be stripped"
    # The real Authorization was re-injected
    assert lower_headers.get("authorization") == "Bearer k"
