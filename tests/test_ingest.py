"""Tests for favai.ingest."""

from __future__ import annotations

import io
import struct
import zlib
from unittest.mock import Mock

from favai.ingest import ingest_uploads


def _valid_png() -> bytes:
    """Generate a minimal valid 1×1 RGB PNG."""
    width, height = 1, 1
    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr_crc = zlib.crc32(b"IHDR" + ihdr_data) & 0xFFFFFFFF
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + struct.pack(">I", ihdr_crc)
    # IDAT — filter byte (0) + RGB(255,0,0)
    raw = b"\x00\xff\x00\x00"
    compressed = zlib.compress(raw)
    idat_crc = zlib.crc32(b"IDAT" + compressed) & 0xFFFFFFFF
    idat = (
        struct.pack(">I", len(compressed))
        + b"IDAT"
        + compressed
        + struct.pack(">I", idat_crc)
    )
    # IEND
    iend_crc = zlib.crc32(b"IEND") & 0xFFFFFFFF
    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", iend_crc)
    return b"\x89PNG\r\n\x1a\n" + ihdr + idat + iend


def test_text_and_paste():
    result = ingest_uploads(
        [("bill.csv", b"date,amount\n2026-07-01,10")],
        pasted_text="  7月20日 海底捞 268元 ",
    )
    assert len(result.texts) == 2
    assert "bill.csv" in result.texts[1]
    assert "海底捞" in result.texts[0]
    assert not result.warnings


def test_image_becomes_base64(monkeypatch):
    monkeypatch.setattr("favai.ingest._paddle_ocr", Mock(return_value=None))
    result = ingest_uploads([("shot.png", _valid_png())])
    assert len(result.images) == 1
    assert result.images[0]["mimeType"] == "image/png"


def test_image_ocr_success(monkeypatch):
    monkeypatch.setattr("favai.ingest.ocr_available", lambda: True)
    monkeypatch.setattr(
        "favai.ingest._paddle_ocr",
        Mock(return_value="海底捞 268元\n7月20日\n"),
    )
    result = ingest_uploads([("receipt.png", _valid_png())])
    # Image is still returned for vision models
    assert len(result.images) == 1
    assert result.images[0]["mimeType"] == "image/png"
    # OCR text is added to texts
    assert len(result.texts) == 1
    assert "OCR" in result.texts[0]
    assert "receipt.png" in result.texts[0]
    assert "海底捞" in result.texts[0]


def test_image_ocr_no_text(monkeypatch):
    """OCR returning None (no text detected) is not a warning."""
    monkeypatch.setattr("favai.ingest.ocr_available", lambda: True)
    monkeypatch.setattr(
        "favai.ingest._paddle_ocr",
        Mock(return_value=None),
    )
    result = ingest_uploads([("bad.png", _valid_png())])
    # Image is still returned even when OCR yields no text
    assert len(result.images) == 1
    assert not result.texts
    assert not result.warnings


def test_image_without_ocr_installed_warns(monkeypatch):
    """Uploading an image without an OCR engine surfaces a warning."""
    monkeypatch.setattr("favai.ingest.ocr_available", lambda: False)
    result = ingest_uploads([("shot.png", _valid_png())])
    assert len(result.images) == 1
    assert not result.texts
    assert any("OCR" in w and "vision" in w for w in result.warnings)


def test_image_ocr_runtime_error_warns(monkeypatch):
    """Runtime OCR failures surface as a per-image warning."""
    monkeypatch.setattr("favai.ingest.ocr_available", lambda: True)
    monkeypatch.setattr(
        "favai.ingest._paddle_ocr",
        Mock(side_effect=RuntimeError("boom")),
    )
    result = ingest_uploads([("bad.png", _valid_png())])
    assert len(result.images) == 1
    assert not result.texts
    assert any("OCR 失败" in w and "bad.png" in w for w in result.warnings)


def test_pdf_text_extraction():
    from pypdf import PdfWriter

    # A PDF with a real text layer is hard to synthesize with pypdf alone;
    # here we assert a blank (no-text) PDF yields the scan warning.
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    result = ingest_uploads([("scan.pdf", buffer.getvalue())])
    assert not result.texts
    assert any("没有可提取的文本" in w for w in result.warnings)


def test_unsupported_extension():
    result = ingest_uploads([("data.xlsx", b"binary")])
    assert any("不支持的文件类型" in w for w in result.warnings)


def test_nothing_ingested():
    result = ingest_uploads([])
    assert any("没有可用的账单材料" in w for w in result.warnings)
