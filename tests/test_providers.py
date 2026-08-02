"""Tests for built-in providers and model discovery."""

from __future__ import annotations

from unittest.mock import Mock

from favai.config import ProviderConfig
from favai.providers import list_provider_models, provider_presets


def test_required_provider_presets_are_available():
    assert {preset["id"] for preset in provider_presets()} == {
        "openai",
        "anthropic",
        "opencode-zen",
        "litellm",
        "deepseek",
        "kimi-coding",
    }


def test_kimi_coding_uses_official_openai_compatible_endpoint():
    kimi = next(
        preset for preset in provider_presets() if preset["id"] == "kimi-coding"
    )
    assert kimi["api"] == "openai-completions"
    assert kimi["base_url"] == "https://api.kimi.com/coding/v1"
    assert kimi["model"] == "kimi-for-coding"


def test_openai_model_discovery(monkeypatch):
    response = Mock()
    response.json.return_value = {"data": [{"id": "z-model"}, {"id": "a-model"}]}
    get = Mock(return_value=response)
    monkeypatch.setattr("favai.providers.httpx.get", get)

    result = list_provider_models(
        ProviderConfig(
            base_url="https://example.test/v1", model="current", api_key="key"
        )
    )

    assert result == ["a-model", "z-model"]
    assert get.call_args.args[0] == "https://example.test/v1/models"
    assert get.call_args.kwargs["headers"]["Authorization"] == "Bearer key"


def test_anthropic_model_discovery(monkeypatch):
    get = Mock()
    get.return_value.json.return_value = {"data": [{"id": "claude-test"}]}
    monkeypatch.setattr("favai.providers.httpx.get", get)

    result = list_provider_models(
        ProviderConfig(
            api="anthropic-messages",
            base_url="https://example.test",
            model="current",
            api_key="key",
        )
    )

    assert result == ["claude-test"]
    assert get.call_args.args[0] == "https://example.test/v1/models"
    assert get.call_args.kwargs["headers"]["x-api-key"] == "key"
