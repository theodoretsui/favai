"""Stateless LLM request forwarder.

The frontend pi-ai SDK (running in the browser) sends LLM requests to the
favai ``llm_proxy`` endpoint with the upstream path (e.g. ``/v1/chat/completions``
or ``/v1/messages``) in the ``X-Favai-Upstream`` header.  This module forwards
the request to the user-configured provider, injecting the real API key.
"""

from __future__ import annotations

import os
import re
from typing import TYPE_CHECKING

import httpx
from flask import Response, stream_with_context

from favai.config import ProviderConfig

if TYPE_CHECKING:
    from collections.abc import Generator

#: Headers that are injected/overridden by the proxy.
_INJECTED_HEADERS = frozenset({"authorization", "x-api-key"})
#: Hop-by-hop and transport headers stripped from the client request.
_SKIP_HEADERS = frozenset(
    {
        "host",
        "content-length",
        "connection",
        "keep-alive",
        "transfer-encoding",
        "upgrade",
        "accept-encoding",
        "proxy-authorization",
        "proxy-authenticate",
        "te",
        "trailer",
        "x-favai-provider",
        "x-favai-upstream",
    }
)

#: Upstream paths must be absolute and contain no path-traversal or URL injection.
_SAFE_UPSTREAM = re.compile(r"^/\S*$")


class ProxyError(ValueError):
    """Raised when the proxy cannot forward the request."""


def _resolve_key(raw: str) -> str:
    """Return the API key; resolve ``$ENV_VAR`` references if present."""
    if raw.startswith("$"):
        var = raw[1:]
        value = os.environ.get(var)
        if not value:
            msg = f"环境变量 {var} 未设置，无法获取 API key"
            raise ProxyError(msg)
        return value
    return raw


def _build_upstream_headers(
    upstream_path: str, headers: dict[str, str], config: ProviderConfig
) -> dict[str, str]:
    """Assemble the headers sent to the upstream provider.

    * Drops hop-by-hop headers and the client's dummy auth headers.
    * Injects the real API key per ``config.api``.
    * Passes through ``content-type``, ``anthropic-version``, and ``anthropic-beta``.
    """
    result: dict[str, str] = {}
    for k, v in headers.items():
        key_lower = k.lower()
        if key_lower in _SKIP_HEADERS or key_lower in _INJECTED_HEADERS:
            continue
        result[k] = v

    api_key = _resolve_key(config.api_key)

    if config.api == "openai-completions" and api_key:
        result["Authorization"] = f"Bearer {api_key}"
    elif config.api == "anthropic-messages":
        if api_key:
            result["x-api-key"] = api_key
        # Ensure the anthropic-version header is present; the SDK always sends it.
        if "anthropic-version" not in result:
            result["anthropic-version"] = "2023-06-01"

    return result


def forward_llm(
    config: ProviderConfig,
    upstream_path: str,
    body: bytes,
    headers: dict[str, str],
) -> Response:
    """Forward a request to the upstream LLM provider and stream the response.

    Args:
        config: The user's LLM provider configuration.
        upstream_path: The upstream path (e.g. ``/v1/chat/completions``).
        body: The raw request body bytes.
        headers: The raw request headers from the client.

    Returns:
        A Flask ``Response`` that streams the upstream response body back.

    Raises:
        ProxyError: If the upstream path is invalid or the API key is missing.
        ConfigError: If the configuration is invalid.
    """
    config.validate()

    if not _SAFE_UPSTREAM.match(upstream_path):
        msg = f"无效的上游路径：{upstream_path!r}"
        raise ProxyError(msg)
    if ".." in upstream_path or "://" in upstream_path:
        msg = f"非法的上游路径：{upstream_path!r}"
        raise ProxyError(msg)

    url = config.base_url.rstrip("/") + upstream_path
    upstream_headers = _build_upstream_headers(upstream_path, headers, config)
    content_type_from_req = upstream_headers.get("content-type", "application/json")

    client = httpx.Client(timeout=httpx.Timeout(300.0, connect=10.0))
    req = client.build_request("POST", url, content=body, headers=upstream_headers)
    upstream_resp = client.send(req, stream=True)
    content_type = upstream_resp.headers.get("content-type", content_type_from_req)

    def generate() -> Generator[bytes]:
        try:
            for chunk in upstream_resp.iter_bytes():  # noqa: UP028
                yield chunk
        finally:
            upstream_resp.close()
            client.close()

    return Response(
        stream_with_context(generate()),
        status=upstream_resp.status_code,
        content_type=content_type,
        direct_passthrough=True,
    )
