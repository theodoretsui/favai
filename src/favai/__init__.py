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
    config_from_public_payload,
    config_path,
    data_dir_for,
    delete_config,
    load_bookkeeping_habits,
    load_config,
    public_configs,
    save_bookkeeping_habits,
    save_config,
)
from favai.entries import source_file_options, to_fava_entries, write_entries
from favai.history import (
    HistoryError,
    archive_session,
    create_session,
    get_session,
    list_sessions,
    mark_confirmed,
    rename_session,
    save_session,
)
from favai.ingest import ingest_uploads
from favai.providers import list_provider_models
from favai.proxy import ProxyError, forward_llm


def api_response(func: Callable[..., Any]) -> Callable[..., dict[str, Any]]:
    """Wrap an endpoint result as ``{success, data|error}``."""

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            return {"success": True, "data": func(*args, **kwargs)}
        except (ConfigError, HistoryError, ProxyError, ValueError) as exc:
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
        # Seed .favai/config.json from the beancount file's extension
        # declaration only once.  Once present, config.json is authoritative:
        # settings saved through the UI must survive Fava reloads.
        self._seed_config(self.data_dir, self.config)
        # Warm up PaddleOCR in the background so the first image import
        # doesn't stall while ~200MB of weights download.  No-op when the
        # optional dependency isn't installed.
        self._warm_up_ocr()

    @staticmethod
    def _warm_up_ocr() -> None:
        from favai.ocr import ocr_available, prefetch

        if not ocr_available():
            return
        import logging
        import threading

        log = logging.getLogger(__name__)

        def _run() -> None:
            try:
                prefetch()
            except Exception:
                log.warning("favai OCR warm-up failed", exc_info=True)

        threading.Thread(target=_run, name="favai-ocr-warmup", daemon=True).start()

    @staticmethod
    def _seed_config(data_dir: Path, extension_config: dict[str, Any] | None) -> None:
        """Create the initial config file from the extension declaration."""
        if extension_config and not config_path(data_dir).exists():
            save_config(data_dir, ProviderConfig(**extension_config))

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
        from favai.ocr import ocr_available

        config = load_config(self.data_dir)
        try:
            config.validate()
            configured = True
        except ConfigError:
            configured = False
        source_files, default_write_path = source_file_options(self.ledger)
        return {
            "configured": configured,
            "ocr_available": ocr_available(),
            "source_files": source_files,
            "default_write_path": default_write_path,
        }

    @extension_endpoint("config", ["GET", "POST"])
    @api_response
    def api_config(self) -> dict[str, Any]:
        """Read or update the LLM provider configuration."""
        if request.method == "POST":
            payload = request.get_json(force=True)
            provider = payload.get("provider") or None
            try:
                current = load_config(self.data_dir, provider)
            except ConfigError:
                current = ProviderConfig(provider=provider or "custom")
            config = config_from_public_payload(current, payload)
            save_config(self.data_dir, config)
        return load_config(self.data_dir).to_public_dict()

    @extension_endpoint("bookkeeping_habits", ["GET", "POST"])
    @api_response
    def api_bookkeeping_habits(self) -> dict[str, str]:
        """Read or update ledger-wide bookkeeping habits."""
        if request.method == "POST":
            payload = request.get_json(force=True)
            save_bookkeeping_habits(
                self.data_dir, payload.get("bookkeeping_habits", "")
            )
        return {"bookkeeping_habits": load_bookkeeping_habits(self.data_dir)}

    @extension_endpoint("provider_configs")
    @api_response
    def api_provider_configs(self) -> list[dict[str, Any]]:
        """Return every provider configuration available to new sessions."""
        return public_configs(self.data_dir)

    @extension_endpoint("provider_config_delete", ["POST"])
    @api_response
    def api_provider_config_delete(self) -> dict[str, bool]:
        """Delete one configured provider."""
        payload = request.get_json(force=True)
        delete_config(self.data_dir, payload.get("provider", ""))
        return {"deleted": True}

    @extension_endpoint("config_test", ["POST"])
    @api_response
    def api_config_test(self) -> dict[str, Any]:
        """Test a provider configuration and persist it only on success."""
        payload = request.get_json(force=True)
        provider = payload.get("provider", "custom")
        try:
            current = load_config(self.data_dir, provider)
        except ConfigError:
            current = ProviderConfig(provider=provider)
        config = config_from_public_payload(current, payload)
        models = list_provider_models(config)
        save_config(self.data_dir, config)
        return {"config": config.to_public_dict(), "models": models}

    @extension_endpoint("models", ["GET", "POST"])
    @api_response
    def api_models(self) -> dict[str, Any]:
        """Discover models for the saved or supplied provider config."""
        if request.method == "POST":
            payload = request.get_json(force=True)
            provider = payload.get("provider") or None
            try:
                config = load_config(self.data_dir, provider)
            except ConfigError:
                config = ProviderConfig(provider=provider or "custom")
            config = config_from_public_payload(
                config,
                payload,
                placeholder_model=True,
            )
        else:
            config = load_config(self.data_dir, request.args.get("provider") or None)
        return {"models": list_provider_models(config)}

    # ------------------------------------------------------------------
    # conversation history
    # ------------------------------------------------------------------

    @extension_endpoint("sessions", ["GET", "POST"])
    @api_response
    def api_sessions(self) -> dict[str, Any]:
        """List sessions or create a new one."""
        if request.method == "POST":
            payload = request.get_json(force=True)
            return create_session(
                self.data_dir,
                title=payload.get("title"),
                model_provider=payload.get("model_provider", ""),
                model_api=payload.get("model_api", ""),
                model_name=payload.get("model_name", ""),
            )
        return list_sessions(
            self.data_dir,
            limit=request.args.get("limit", 30, type=int),
            offset=request.args.get("offset", 0, type=int),
        )

    @extension_endpoint("session", ["GET", "POST"])
    @api_response
    def api_session(self) -> dict[str, Any]:
        """Load or rename one session."""
        if request.method == "POST":
            payload = request.get_json(force=True)
            return rename_session(
                self.data_dir, payload.get("session_id", ""), payload.get("title", "")
            )
        return get_session(self.data_dir, request.args.get("session_id", ""))

    @extension_endpoint("session_save", ["POST"])
    @api_response
    def api_session_save(self) -> dict[str, Any]:
        """Atomically persist a complete conversation snapshot."""
        payload = request.get_json(force=True)
        return save_session(
            self.data_dir,
            payload.get("session_id", ""),
            expected_revision=payload.get("expected_revision", -1),
            messages=payload.get("messages", []),
            proposal=payload.get("proposal"),
            proposal_dirty=bool(payload.get("proposal_dirty", False)),
            pending_proposal=payload.get("pending_proposal"),
            title=payload.get("title"),
        )

    @extension_endpoint("session_delete", ["POST"])
    @api_response
    def api_session_delete(self) -> dict[str, Any]:
        """Archive a conversation session."""
        payload = request.get_json(force=True)
        archive_session(self.data_dir, payload.get("session_id", ""))
        return {"deleted": True}

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
        vision = request.form.get("vision", "false").lower() == "true"
        result = ingest_uploads(files, pasted, vision=vision)
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
        provider = request.headers.get("X-Favai-Provider") or None
        try:
            config = load_config(self.data_dir, provider)
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
        write_path = str(payload.get("write_path") or "").strip() or None
        write_entries(self.ledger, entries, write_path)
        session_id = payload.get("session_id")
        if session_id:
            mark_confirmed(self.data_dir, session_id, transactions=transactions)
        return {"inserted": len(entries), "write_path": write_path}
