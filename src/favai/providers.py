"""LLM provider model discovery."""

from __future__ import annotations

import httpx

from favai.config import ProviderConfig
from favai.proxy import ProxyError, _build_upstream_headers


def list_provider_models(config: ProviderConfig) -> list[str]:
    """Fetch model identifiers using the provider's standard Models API."""
    config.validate()
    path = "/v1/models" if config.api == "anthropic-messages" else "/models"
    url = config.base_url.rstrip("/") + path
    headers = _build_upstream_headers(path, {"accept": "application/json"}, config)
    try:
        response = httpx.get(url, headers=headers, timeout=15.0)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ProxyError(f"获取模型列表失败：{exc}") from exc

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise ProxyError("获取模型列表失败：响应中缺少 data 数组")
    models = {
        item["id"]
        for item in data
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]
    }
    return sorted(models, key=str.casefold)
