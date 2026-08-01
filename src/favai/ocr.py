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


def prefetch() -> None:
    """Force PaddleOCR to load (and, on first run, download) its models.

    Intended for post-install warm-up so the first user request doesn't
    stall while several hundred MB of ONNX weights stream in.
    Raises ``RuntimeError`` if PaddleOCR is not installed.
    """
    _get_ocr()


def _format_tui(page: dict[str, Any]) -> str:
    """Format a single OCR page result as a TUI-style spatial layout.

    Groups text blocks into rows by y-coordinate (adaptive tolerance:
    40% of median text height), sorts each row left-to-right, and
    inserts blank lines between visual blocks.

    Falls back to plain newline-joined text when bounding boxes are
    unavailable or don't match the texts.
    """
    texts = _get(page, "rec_texts", [])
    boxes = _get(page, "rec_boxes", None)

    # Normalize to plain Python lists — PaddleOCR onnxruntime may return
    # numpy arrays, and bool(numpy_array) raises "ambiguous truth value".
    texts = list(texts) if texts is not None else []
    if not texts:
        return ""

    if boxes is not None:
        boxes = list(boxes)
    else:
        boxes = []

    if not boxes or len(texts) != len(boxes):
        return "\n".join(texts)

    # rec_boxes is xyxy: [[x1, y1, x2, y2], ...]
    items: list[tuple[str, float, float]] = []
    text_heights: list[float] = []
    for i, t in enumerate(texts):
        box = boxes[i]
        x1 = float(box[0])
        y1 = float(box[1])
        y2 = float(box[3]) if len(box) > 3 else y1
        items.append((t, x1, y1))
        text_heights.append(y2 - y1)

    # Adaptive tolerance: 40% of median text height
    text_heights.sort()
    TOL = 0.4 * text_heights[len(text_heights) // 2]

    # Group into rows by y-coordinate
    rows: list[list[tuple[str, float]]] = []
    row_ys: list[float] = []
    for t, x, y in items:
        placed = False
        for ri, ry in enumerate(row_ys):
            if abs(ry - y) < TOL:
                rows[ri].append((t, x))
                row_ys[ri] = (ry + y) / 2.0
                placed = True
                break
        if not placed:
            rows.append([(t, x)])
            row_ys.append(y)

    if not rows:
        return ""

    # Sort rows by y, items within each row by x
    order = sorted(range(len(rows)), key=lambda i: row_ys[i])
    sorted_rows = [(row_ys[ri], sorted(rows[ri], key=lambda p: p[1])) for ri in order]

    # Compute median gap between consecutive rows for block detection
    if len(sorted_rows) > 1:
        gaps = [
            sorted_rows[i + 1][0] - sorted_rows[i][0]
            for i in range(len(sorted_rows) - 1)
        ]
        gaps.sort()
        median_gap = gaps[len(gaps) // 2]
    else:
        median_gap = 0.0

    # Build output, inserting blank lines between blocks
    out: list[str] = []
    for i, (_, row) in enumerate(sorted_rows):
        out.append("  ".join(t for t, _ in row))
        if i < len(sorted_rows) - 1:
            gap = sorted_rows[i + 1][0] - sorted_rows[i][0]
            if median_gap > 0 and gap > median_gap * 1.5:
                out.append("")
    return "\n".join(out)


def ocr_image(data: bytes) -> str | None:
    """Run OCR on raw image bytes and return the extracted text.

    Returns ``None`` if PaddleOCR is not installed or no text was found.
    Raises the underlying exception if OCR fails at runtime.
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
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    parts: list[str] = []
    for page in pages:
        parts.append(_format_tui(page))
    text = "\n\n".join(parts).strip()
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
