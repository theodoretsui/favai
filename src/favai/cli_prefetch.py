"""Command-line helper to warm up the PaddleOCR model cache.

Run once after ``pip install favai[ocr]`` so the first bill import doesn't
stall while several hundred MB of ONNX weights download.
"""

from __future__ import annotations

import sys
import time


def main() -> int:
    try:
        from favai.ocr import ocr_available, prefetch
    except ImportError as exc:  # pragma: no cover - trivial guard
        print(f"favai is not importable: {exc}", file=sys.stderr)
        return 2

    if not ocr_available():
        print(
            "paddleocr is not installed. Install with: pip install 'favai[ocr]'",
            file=sys.stderr,
        )
        return 1

    print("Warming up PaddleOCR models (first run downloads ~200MB)…")
    start = time.monotonic()
    try:
        prefetch()
    except Exception as exc:  # noqa: BLE001 - surface any failure to the user
        print(f"OCR prefetch failed: {exc}", file=sys.stderr)
        return 1
    elapsed = time.monotonic() - start
    print(f"OCR models ready ({elapsed:.1f}s).")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
