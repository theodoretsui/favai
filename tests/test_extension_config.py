"""Tests for favai extension configuration precedence."""

from __future__ import annotations

from favai import FavaAI
from favai.config import ProviderConfig, load_config, save_config


def test_existing_config_file_overrides_extension_declaration(tmp_path):
    """A UI-saved config is not reset when Fava reloads the extension."""
    saved = ProviderConfig(base_url="https://api.example.com", model="new-model")
    save_config(tmp_path, saved)

    FavaAI._seed_config(
        tmp_path,
        {"base_url": "https://api.example.com", "model": "old-model"},
    )

    assert load_config(tmp_path) == saved


def test_extension_declaration_seeds_missing_config_file(tmp_path):
    FavaAI._seed_config(
        tmp_path,
        {"base_url": "https://api.example.com", "model": "initial-model"},
    )

    assert load_config(tmp_path).model == "initial-model"
