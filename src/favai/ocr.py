"""PaddleOCR integration for bill image text extraction.

Uses PaddleOCR with onnxruntime engine (Apple Silicon CoreML compatible).
The OCR model is loaded lazily once and reused across calls.

Install with: ``pip install favai[ocr]``
"""

from __future__ import annotations

import os
import tempfile
import threading
from typing import Any

try:
    from paddleocr import PaddleOCR

    _HAS_PADDLEOCR = True
except ImportError:
    _HAS_PADDLEOCR = False
    PaddleOCR = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Lazy init with double-checked locking (model loading is expensive)
# ---------------------------------------------------------------------------

_ocr: PaddleOCR | None = None  # type: ignore[valid-type]
_ocr_lock = threading.Lock()


def _get_ocr() -> PaddleOCR:  # type: ignore[valid-type]
    global _ocr
    if not _HAS_PADDLEOCR:
        raise RuntimeError(
            "paddleocr is not installed. Install with: pip install favai[ocr]"
        )
    if _ocr is None:
        with _ocr_lock:
            if _ocr is None:
                _ocr = PaddleOCR(
                    lang="ch",
                    use_textline_orientation=True,
                    ocr_version="PP-OCRv6",
                    engine="onnxruntime",
                )
    return _ocr


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def ocr_available() -> bool:
    """Return ``True`` if PaddleOCR is installed and available."""
    return _HAS_PADDLEOCR


def ocr_image(data: bytes) -> str | None:
    """Run OCR on raw image bytes and return the extracted text.

    Returns ``None`` if PaddleOCR is not installed, no text was found,
    or if OCR fails.
    """
    if not _HAS_PADDLEOCR:
        return None

    suffix = _guess_ext(data)
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
        tmp_path = f.name

    try:
        ocr = _get_ocr()
        pages = list(ocr.predict(tmp_path))
    except Exception:  # noqa: BLE001 — OCR failure is silently ignored
        return None
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    lines: list[str] = []
    for page in pages:
        texts = _get(page, "rec_texts", [])
        lines.extend(texts)
    text = "\n".join(lines).strip()
    return text if text else None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get(res: Any, key: str, default: Any = None) -> Any:
    """Extract a field from either a dict or an object with attrs."""
    if isinstance(res, dict):
        return res.get(key, default)
    return getattr(res, key, default)


_IMAGE_SIGNATURES: dict[bytes, str] = {
    b"\x89PNG\r\n\x1a\n": ".png",
    b"\xff\xd8\xff": ".jpg",
    b"GIF87a": ".gif",
    b"GIF89a": ".gif",
    b"RIFF": ".webp",
}


def _guess_ext(data: bytes) -> str:
    """Guess image file extension from magic bytes."""
    for magic, ext in _IMAGE_SIGNATURES.items():
        if data.startswith(magic):
            if ext == ".webp" and data[8:12] != b"WEBP":
                continue
            return ext
    return ".png"
