"""Tests for favai.config."""

from __future__ import annotations

import json

import pytest

from favai.config import (
    ConfigError,
    ProviderConfig,
    config_from_public_payload,
    delete_config,
    load_config,
    load_configs,
    save_config,
)


def test_roundtrip(tmp_path):
    config = ProviderConfig(
        api="anthropic-messages",
        base_url="https://example.com",
        model="m",
        api_key="$KEY",
        context_window=200_000,
        max_tokens=8_192,
    )
    save_config(tmp_path, config)
    assert load_config(tmp_path) == config
    raw = json.loads((tmp_path / "config.json").read_text())
    assert raw == [config.__dict__]


def test_multiple_provider_configs_are_upserted(tmp_path):
    openai = ProviderConfig(
        provider="openai", base_url="https://api.openai.com/v1", model="gpt"
    )
    anthropic = ProviderConfig(
        provider="anthropic",
        api="anthropic-messages",
        base_url="https://api.anthropic.com",
        model="claude",
    )
    save_config(tmp_path, openai)
    save_config(tmp_path, anthropic)

    active, configs = load_configs(tmp_path)
    assert active == "anthropic"
    assert configs == [openai, anthropic]
    assert load_config(tmp_path, "openai") == openai


def test_delete_provider_config(tmp_path):
    save_config(tmp_path, ProviderConfig(provider="a", base_url="https://a", model="m"))
    save_config(tmp_path, ProviderConfig(provider="b", base_url="https://b", model="m"))

    delete_config(tmp_path, "a")

    assert [config.provider for config in load_configs(tmp_path)[1]] == ["b"]
    with pytest.raises(ConfigError, match="尚未配置"):
        delete_config(tmp_path, "missing")


def test_delete_last_provider_returns_to_defaults(tmp_path):
    save_config(
        tmp_path,
        ProviderConfig(provider="only", base_url="https://only", model="m"),
    )

    delete_config(tmp_path, "only")

    assert load_configs(tmp_path)[1] == []
    assert load_config(tmp_path) == ProviderConfig()


def test_legacy_flat_config_is_loaded(tmp_path):
    (tmp_path / "config.json").write_text(
        json.dumps(
            {
                "provider": "deepseek",
                "base_url": "https://api.deepseek.com",
                "model": "deepseek-v4-flash",
            }
        )
    )
    assert load_config(tmp_path).provider == "deepseek"


def test_load_defaults_when_missing(tmp_path):
    assert load_config(tmp_path) == ProviderConfig()


def test_load_ignores_unknown_keys(tmp_path):
    save_config(tmp_path, ProviderConfig(base_url="https://x", model="m"))
    raw = json.loads((tmp_path / "config.json").read_text())
    raw[0]["future_key"] = 1
    (tmp_path / "config.json").write_text(json.dumps(raw))
    assert load_config(tmp_path).base_url == "https://x"


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"api": "bogus"}, "Unsupported api"),
        ({"base_url": ""}, "base_url is required"),
        ({"model": ""}, "model is required"),
    ],
)
def test_validate_errors(tmp_path, kwargs, match):
    params = {"base_url": "https://x", "model": "m", **kwargs}
    config = ProviderConfig(**params)
    with pytest.raises(ConfigError, match=match):
        save_config(tmp_path, config)


def test_public_dict_masks_literal_key():
    config = ProviderConfig(api_key="sk-secret-123")
    public = config.to_public_dict()
    assert public["api_key"] == "sk-s****"
    assert public["api_key_stored"] is True


def test_public_dict_keeps_env_reference():
    config = ProviderConfig(api_key="$MY_KEY")
    public = config.to_public_dict()
    assert public["api_key"] == "$MY_KEY"
    assert public["api_key_stored"] is True


def test_public_dict_includes_legacy_model_in_supported_models():
    public = ProviderConfig(model="legacy-model").to_public_dict()
    assert public["models"] == ["legacy-model"]


def test_public_payload_normalizes_supported_models():
    updated = config_from_public_payload(
        ProviderConfig(model="old"),
        {"models": ["new-a", "new-a", "new-b"], "model": "old"},
    )
    assert updated.models == ["new-a", "new-b"]
    assert updated.model == "new-a"


def test_public_payload_keeps_masked_key_for_same_provider():
    current = ProviderConfig(provider="openai", api_key="secret")
    updated = config_from_public_payload(
        current, {"provider": "openai", "api_key": "secr****"}
    )
    assert updated.api_key == "secret"


def test_public_payload_clears_key_when_provider_changes():
    current = ProviderConfig(provider="openai", api_key="openai-secret")
    updated = config_from_public_payload(
        current, {"provider": "anthropic", "api_key": ""}
    )
    assert updated.api_key == ""
