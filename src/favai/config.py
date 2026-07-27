"""Provider configuration for favai.

The user-facing config is stored as ``config.json`` in the favai data
directory (``.favai/`` next to the beancount file).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

#: pi ``api`` values we support for custom providers.
SUPPORTED_APIS = ("openai-completions", "anthropic-messages")

DEFAULT_CONTEXT_WINDOW = 128_000
DEFAULT_MAX_TOKENS = 16_384


class ConfigError(ValueError):
    """Raised when the provider configuration is invalid."""


@dataclass
class ProviderConfig:
    """User-adjustable LLM provider settings."""

    api: str = "openai-completions"
    base_url: str = ""
    model: str = ""
    api_key: str = ""  # literal key or "$ENV_VAR" reference
    vision: bool = True
    context_window: int = DEFAULT_CONTEXT_WINDOW
    max_tokens: int = DEFAULT_MAX_TOKENS

    def validate(self) -> None:
        """Raise ConfigError if the configuration is incomplete."""
        if self.api not in SUPPORTED_APIS:
            msg = f"Unsupported api '{self.api}', expected one of {SUPPORTED_APIS}"
            raise ConfigError(msg)
        if not self.base_url:
            msg = "base_url is required"
            raise ConfigError(msg)
        if not self.model:
            msg = "model is required"
            raise ConfigError(msg)

    def to_public_dict(self) -> dict[str, Any]:
        """Config as returned to the frontend (api key masked)."""
        data = asdict(self)
        key = self.api_key
        if key and not key.startswith("$"):
            data["api_key"] = key[:4] + "****" if len(key) > 4 else "****"
            data["api_key_stored"] = True
        else:
            data["api_key_stored"] = bool(key)
        return data


def data_dir_for(beancount_file: str) -> Path:
    """The favai data directory for a ledger (``.favai/`` next to the file)."""
    return Path(beancount_file).parent / ".favai"


def config_path(data_dir: Path) -> Path:
    """Path to ``config.json`` inside a favai data directory."""
    return data_dir / "config.json"


def _config_path(data_dir: Path) -> Path:
    return config_path(data_dir)


def load_config(data_dir: Path) -> ProviderConfig:
    """Load the provider config, falling back to defaults."""
    path = _config_path(data_dir)
    if not path.exists():
        return ProviderConfig()
    raw = json.loads(path.read_text(encoding="utf-8"))
    known = ProviderConfig.__dataclass_fields__
    return ProviderConfig(**{k: v for k, v in raw.items() if k in known})


def save_config(data_dir: Path, config: ProviderConfig) -> None:
    """Persist the config and regenerate pi's ``models.json``."""
    config.validate()
    data_dir.mkdir(parents=True, exist_ok=True)
    _config_path(data_dir).write_text(
        json.dumps(asdict(config), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
