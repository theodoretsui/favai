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
        # Seed (or re-seed) .favai/config.json from the beancount file's
        # extension declaration on every startup.  The beancount file is the
        # primary configuration source; runtime changes via the Settings UI
        # survive until the next restart / reload.
        if self.config:
            parsed = ProviderConfig(**self.config)
            save_config(self.data_dir, parsed)
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
        return {"configured": configured, "ocr_available": ocr_available()}

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
                title=payload.get("title", "新对话"),
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
        session_id = payload.get("session_id")
        if session_id:
            mark_confirmed(self.data_dir, session_id, count=len(entries))
        return {"inserted": len(entries)}
