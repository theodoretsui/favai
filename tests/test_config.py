"""Tests for favai.config."""

from __future__ import annotations

import json

import pytest

from favai.config import (
    ConfigError,
    ProviderConfig,
    load_config,
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


def test_load_defaults_when_missing(tmp_path):
    assert load_config(tmp_path) == ProviderConfig()


def test_load_ignores_unknown_keys(tmp_path):
    save_config(tmp_path, ProviderConfig(base_url="https://x", model="m"))
    raw = json.loads((tmp_path / "config.json").read_text())
    raw["future_key"] = 1
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
