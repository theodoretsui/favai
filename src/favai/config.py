"""Provider configuration for favai.

The user-facing config is stored as ``config.json`` in the favai data
directory (``.favai/`` next to the beancount file).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
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

    provider: str = "custom"
    api: str = "openai-completions"
    base_url: str = ""
    model: str = ""
    models: list[str] = field(default_factory=list)
    api_key: str = ""  # literal key or "$ENV_VAR" reference
    vision: bool = True
    context_window: int = DEFAULT_CONTEXT_WINDOW
    max_tokens: int = DEFAULT_MAX_TOKENS

    def validate(self) -> None:
        """Raise ConfigError if the configuration is incomplete."""
        if not self.provider.strip():
            raise ConfigError("provider is required")
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
        data["models"] = list(dict.fromkeys([*self.models, self.model]))
        data["models"] = [model for model in data["models"] if model]
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


def load_configs(data_dir: Path) -> tuple[str, list[ProviderConfig]]:
    """Load all provider configs, migrating the legacy flat shape in memory."""
    path = _config_path(data_dir)
    if not path.exists():
        return "", []
    raw = json.loads(path.read_text(encoding="utf-8"))
    known = ProviderConfig.__dataclass_fields__
    if isinstance(raw, list):
        configs = [
            ProviderConfig(**{k: v for k, v in item.items() if k in known})
            for item in raw
            if isinstance(item, dict)
        ]
        return (configs[-1].provider if configs else ""), configs
    if isinstance(raw, dict) and isinstance(raw.get("providers"), list):
        configs = [
            ProviderConfig(**{k: v for k, v in item.items() if k in known})
            for item in raw["providers"]
            if isinstance(item, dict)
        ]
        return str(raw.get("active_provider", "")), configs
    if isinstance(raw, dict):
        legacy = ProviderConfig(**{k: v for k, v in raw.items() if k in known})
        return legacy.provider, [legacy]
    raise ConfigError("config.json 必须是配置数组")


def load_config(data_dir: Path, provider: str | None = None) -> ProviderConfig:
    """Load one provider config, falling back to defaults."""
    active_provider, configs = load_configs(data_dir)
    target = provider or active_provider
    if target:
        for config in configs:
            if config.provider == target:
                return config
    if provider:
        raise ConfigError(f"提供商 {provider!r} 尚未配置")
    return configs[0] if configs else ProviderConfig()


def public_configs(data_dir: Path) -> list[dict[str, Any]]:
    """Return all stored configs with literal keys masked."""
    return [config.to_public_dict() for config in load_configs(data_dir)[1]]


def config_from_public_payload(
    current: ProviderConfig,
    payload: dict[str, Any],
    *,
    placeholder_model: bool = False,
) -> ProviderConfig:
    """Build a config from frontend data without losing a masked stored key."""
    provider = payload.get("provider", current.provider)
    submitted_key = payload.get("api_key", "")
    keep_key = provider == current.provider and (
        not submitted_key or "****" in submitted_key
    )
    raw_models = payload.get("models", current.models)
    if not isinstance(raw_models, list):
        raise ConfigError("models must be an array")
    models = list(
        dict.fromkeys(
            model.strip()
            for model in raw_models
            if isinstance(model, str) and model.strip()
        )
    )
    model = payload.get("model", current.model)
    if models and model not in models:
        model = models[0]
    elif model and model not in models:
        models.append(model)
    if placeholder_model and not model:
        model = "model-discovery"
    return ProviderConfig(
        provider=provider,
        api=payload.get("api", current.api),
        base_url=payload.get("base_url", current.base_url),
        model=model,
        models=models,
        api_key=current.api_key if keep_key else submitted_key,
        vision=bool(payload.get("vision", current.vision)),
        context_window=int(payload.get("context_window", current.context_window)),
        max_tokens=int(payload.get("max_tokens", current.max_tokens)),
    )


def save_config(data_dir: Path, config: ProviderConfig) -> None:
    """Upsert a provider config and make it the active default."""
    config.validate()
    data_dir.mkdir(parents=True, exist_ok=True)
    _, configs = load_configs(data_dir)
    updated = [existing for existing in configs if existing.provider != config.provider]
    updated.append(config)
    _config_path(data_dir).write_text(
        json.dumps(
            [asdict(item) for item in updated],
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )


def delete_config(data_dir: Path, provider: str) -> None:
    """Delete one stored provider configuration."""
    provider = provider.strip()
    if not provider:
        raise ConfigError("provider is required")
    _, configs = load_configs(data_dir)
    updated = [config for config in configs if config.provider != provider]
    if len(updated) == len(configs):
        raise ConfigError(f"提供商 {provider!r} 尚未配置")
    _config_path(data_dir).write_text(
        json.dumps(
            [asdict(item) for item in updated],
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
