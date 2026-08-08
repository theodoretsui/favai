"""Tests for favai.proxy — pure function tests.

``forward_llm`` returns a Flask ``Response`` (via ``stream_with_context``)
which requires a request context, so it is tested via the endpoint integration
tests.  Here we test the internal helper functions in isolation.
"""

from __future__ import annotations

from unittest.mock import Mock

import httpx
import pytest

from favai.config import ProviderConfig
from favai.proxy import (
    _SAFE_UPSTREAM,
    ProxyError,
    _build_upstream_body,
    _build_upstream_headers,
    _resolve_key,
    forward_llm,
)

# ---------------------------------------------------------------------------
# _build_upstream_body
# ---------------------------------------------------------------------------


def test_qualified_model_is_unwrapped_for_upstream():
    config = ProviderConfig(provider="openai", model="shared-model")
    body = b'{"model":"openai/shared-model","messages":[]}'

    result = _build_upstream_body(body, config)

    assert result == b'{"model":"shared-model","messages":[]}'


def test_non_default_qualified_model_is_unwrapped_for_upstream():
    config = ProviderConfig(
        provider="hzw",
        model="default-model",
        models=["default-model", "custom/gpt-5.6-sol"],
    )
    body = b'{"model":"hzw/custom/gpt-5.6-sol","messages":[]}'

    result = _build_upstream_body(body, config)

    assert result == b'{"model":"custom/gpt-5.6-sol","messages":[]}'


def test_legacy_unqualified_model_body_is_unchanged():
    config = ProviderConfig(provider="openai", model="shared-model")
    body = b'{"model": "shared-model", "messages": []}'

    assert _build_upstream_body(body, config) is body


def test_other_provider_model_body_is_unchanged():
    config = ProviderConfig(provider="openai", model="shared-model")
    body = b'{"model":"anthropic/shared-model","messages":[]}'

    assert _build_upstream_body(body, config) is body


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


def test_openai_empty_key_omits_authorization_header():
    config = ProviderConfig(
        api="openai-completions",
        base_url="http://localhost:4000/v1",
        model="local-model",
        api_key="",
    )
    headers = _build_upstream_headers("/models", {"accept": "application/json"}, config)
    assert "Authorization" not in headers


def test_internal_provider_routing_headers_are_not_forwarded(monkeypatch):
    monkeypatch.setenv("KEY", "key")
    config = ProviderConfig(
        base_url="https://example.test", model="model", api_key="$KEY"
    )
    headers = _build_upstream_headers(
        "/chat/completions",
        {
            "X-Favai-Provider": "deepseek",
            "X-Favai-Upstream": "/chat/completions",
        },
        config,
    )
    assert not any(name.lower().startswith("x-favai-") for name in headers)


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


def test_anthropic_empty_key_omits_api_key_but_keeps_version():
    config = ProviderConfig(
        api="anthropic-messages",
        base_url="http://localhost:4000",
        model="local-model",
        api_key="",
    )
    headers = _build_upstream_headers("/v1/models", {}, config)
    assert "x-api-key" not in headers
    assert headers["anthropic-version"] == "2023-06-01"


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


def test_forward_llm_reports_connection_error_and_closes_client(monkeypatch):
    client = Mock()
    request = httpx.Request("POST", "https://example.test/v1/chat/completions")
    client.build_request.return_value = request
    client.send.side_effect = httpx.ConnectError(
        "TLS handshake failed", request=request
    )
    monkeypatch.setattr("favai.proxy.httpx.Client", Mock(return_value=client))

    config = ProviderConfig(
        base_url="https://example.test/v1",
        model="test-model",
        api_key="test-key",
    )

    with pytest.raises(ProxyError, match="连接 LLM 服务失败.*TLS handshake failed"):
        forward_llm(
            config,
            "/chat/completions",
            b"{}",
            {"content-type": "application/json"},
        )

    client.close.assert_called_once_with()
