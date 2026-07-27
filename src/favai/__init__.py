"""favai - AI-powered bill import extension for Fava."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from pathlib import Path
from typing import Any

from fava.ext import FavaExtensionBase, extension_endpoint
from flask import request

from favai.config import (
    ConfigError,
    ProviderConfig,
    data_dir_for,
    load_config,
    save_config,
)
from favai.entries import to_fava_entries
from favai.ingest import ingest_uploads
from favai.proxy import ProxyError, forward_llm


def api_response(func: Callable[..., Any]) -> Callable[..., dict[str, Any]]:
    """Wrap an endpoint result as ``{success, data|error}``."""

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            return {"success": True, "data": func(*args, **kwargs)}
        except (ConfigError, ProxyError, ValueError) as exc:
            return {"success": False, "error": str(exc)}
        except Exception as exc:  # noqa: BLE001 - surfaced to the frontend
            return {"success": False, "error": f"{type(exc).__name__}: {exc}"}

    return wrapper


class FavaAI(FavaExtensionBase):
    """Import bills into the ledger with the help of an LLM agent."""

    report_title = "FavAI"
    has_js_module = True

    def __init__(self, ledger: Any, config: str | None = None) -> None:
        super().__init__(ledger, config)
        # Seed (or re-seed) .favai/config.json from the beancount file's
        # extension declaration on every startup.  The beancount file is the
        # primary configuration source; runtime changes via the Settings UI
        # survive until the next restart / reload.
        if self.config:
            parsed = ProviderConfig(**self.config)
            save_config(self.data_dir, parsed)

    @property
    def data_dir(self) -> Path:
        """Directory holding favai's config files."""
        return data_dir_for(self.ledger.beancount_file_path)

    # ------------------------------------------------------------------
    # status / config
    # ------------------------------------------------------------------

    @extension_endpoint("status")
    @api_response
    def api_status(self) -> dict[str, Any]:
        """Check whether the provider is configured."""
        config = load_config(self.data_dir)
        try:
            config.validate()
            return {"configured": True}
        except ConfigError:
            return {"configured": False}

    @extension_endpoint("config", ["GET", "POST"])
    @api_response
    def api_config(self) -> dict[str, Any]:
        """Read or update the LLM provider configuration."""
        if request.method == "POST":
            payload = request.get_json(force=True)
            current = load_config(self.data_dir)
            config = ProviderConfig(
                api=payload.get("api", current.api),
                base_url=payload.get("base_url", current.base_url),
                model=payload.get("model", current.model),
                # An empty or masked api_key keeps the previously stored one.
                api_key=(
                    current.api_key
                    if not payload.get("api_key") or "****" in payload["api_key"]
                    else payload["api_key"]
                ),
                vision=bool(payload.get("vision", current.vision)),
                context_window=int(
                    payload.get("context_window", current.context_window)
                ),
                max_tokens=int(payload.get("max_tokens", current.max_tokens)),
            )
            save_config(self.data_dir, config)
        return load_config(self.data_dir).to_public_dict()

    # ------------------------------------------------------------------
    # ingest
    # ------------------------------------------------------------------

    @extension_endpoint("ingest", ["POST"])
    @api_response
    def api_ingest(self) -> dict[str, Any]:
        """Ingest uploaded files and pasted text (no agent)."""
        files = [
            (upload.filename or "unnamed", upload.read())
            for upload in request.files.getlist("files")
        ]
        pasted = request.form.get("text", "")
        result = ingest_uploads(files, pasted)
        return {
            "texts": result.texts,
            "images": result.images,
            "warnings": result.warnings,
        }

    # ------------------------------------------------------------------
    # LLM proxy (not wrapped in api_response — raw pass-through)
    # ------------------------------------------------------------------

    @extension_endpoint("llm_proxy", ["POST"])
    def api_llm_proxy(self) -> Any:
        """Forward the request to the configured LLM provider.

        This endpoint does **not** use ``api_response`` because it must return
        the upstream response as-is (including streaming SSE chunks).
        Errors are returned as ``{"success": false, "error": "..."}`` JSON.
        """
        config = load_config(self.data_dir)
        try:
            config.validate()
        except ConfigError as exc:
            return {"success": False, "error": str(exc)}

        upstream_path = request.headers.get("X-Favai-Upstream", "")
        try:
            return forward_llm(
                config, upstream_path, request.get_data(), dict(request.headers)
            )
        except (ProxyError, ConfigError) as exc:
            return {"success": False, "error": str(exc)}

    # ------------------------------------------------------------------
    # write entries
    # ------------------------------------------------------------------

    @extension_endpoint("import_confirm", ["POST"])
    @api_response
    def api_import_confirm(self) -> dict[str, Any]:
        """Write the (possibly user-edited) proposal into the ledger."""
        payload = request.get_json(force=True)
        transactions = payload.get("transactions") or []
        currencies = self.ledger.options["operating_currency"]
        default_currency = currencies[0] if currencies else "CNY"
        entries_json = to_fava_entries(transactions, default_currency)
        # Imported lazily: fava.serialisation must load after fava.core
        # to avoid a circular import at module level.
        from fava.serialisation import deserialise

        entries = [deserialise(entry) for entry in entries_json]
        self.ledger.file.insert_entries(entries)
        return {"inserted": len(entries)}
