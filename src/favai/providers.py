"""Built-in LLM provider presets and model discovery."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import httpx

from favai.config import ProviderConfig
from favai.proxy import ProxyError, _build_upstream_headers


@dataclass(frozen=True)
class ProviderPreset:
    """A quick-start configuration for a commonly used provider."""

    id: str
    name: str
    api: str
    base_url: str
    model: str = ""
    vision: bool = False


PROVIDER_PRESETS = (
    ProviderPreset(
        "openai",
        "OpenAI",
        "openai-completions",
        "https://api.openai.com/v1",
        "gpt-4.1",
        True,
    ),
    ProviderPreset(
        "anthropic",
        "Anthropic",
        "anthropic-messages",
        "https://api.anthropic.com",
        "claude-sonnet-4-6",
        True,
    ),
    ProviderPreset(
        "opencode-zen",
        "OpenCode Zen",
        "openai-completions",
        "https://opencode.ai/zen/v1",
    ),
    ProviderPreset(
        "litellm", "LiteLLM", "openai-completions", "http://localhost:4000/v1"
    ),
    ProviderPreset(
        "deepseek",
        "DeepSeek",
        "openai-completions",
        "https://api.deepseek.com",
        "deepseek-v4-flash",
    ),
    ProviderPreset(
        "kimi-coding",
        "Kimi Coding Plan",
        "openai-completions",
        "https://api.kimi.com/coding/v1",
        "kimi-for-coding",
    ),
)


def provider_presets() -> list[dict[str, Any]]:
    """Return serialisable built-in provider presets."""
    return [asdict(preset) for preset in PROVIDER_PRESETS]


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
