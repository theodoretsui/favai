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


def test_vision_image_skips_ocr(monkeypatch):
    ocr = Mock()
    monkeypatch.setattr("favai.ingest.ocr_available", Mock(return_value=True))
    monkeypatch.setattr("favai.ingest._paddle_ocr", ocr)

    result = ingest_uploads([("receipt.png", _valid_png())], vision=True)

    assert len(result.images) == 1
    assert not result.texts
    assert not result.warnings
    ocr.assert_not_called()


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
    result = ingest_uploads([("data.xyz", b"binary")])
    assert any("不支持的文件类型" in w for w in result.warnings)


def test_anydoc_format_without_parser_hints():
    """Known anydoc formats get an actionable hint when the parser is absent."""
    result = ingest_uploads([("data.xlsx", b"binary")])
    assert any("favai[anydoc]" in w for w in result.warnings)
    assert not result.texts


def test_anydoc_document_converted(monkeypatch):
    """With anydoc installed, office documents become Markdown text."""
    fake = _install_fake_anydoc(monkeypatch)
    fake.to_markdown_bytes.return_value = "# 报销单\n\n- 海底捞 268 元\n"

    result = ingest_uploads([("bill.docx", b"PK\x03\x04fake")])

    assert len(result.texts) == 1
    assert "bill.docx" in result.texts[0]
    assert "海底捞" in result.texts[0]
    assert not result.warnings
    fake.format_from_extension.assert_called_once_with(".docx")


def test_anydoc_document_failure_warns(monkeypatch):
    """anydoc conversion failures surface as a per-file warning."""
    fake = _install_fake_anydoc(monkeypatch)
    fake.to_markdown_bytes.side_effect = RuntimeError("boom")

    result = ingest_uploads([("bill.xlsx", b"binary")])

    assert not result.texts
    assert any("解析失败" in w and "bill.xlsx" in w for w in result.warnings)


def test_anydoc_csv_becomes_markdown(monkeypatch):
    """CSV is converted to a Markdown table when anydoc is installed."""
    fake = _install_fake_anydoc(monkeypatch)
    fake.to_markdown_bytes.return_value = "| date | amount |\n| --- | --- |\n"

    result = ingest_uploads([("bill.csv", b"date,amount\n")])

    assert len(result.texts) == 1
    assert "bill.csv" in result.texts[0]
    fake.format_from_extension.assert_called_once_with(".csv")


def test_anydoc_pdf_preferred(monkeypatch):
    """Text-layer PDFs are extracted by anydoc when installed."""
    fake = _install_fake_anydoc(monkeypatch)
    fake.to_markdown_bytes.return_value = "## 银行对账单\n\n2026-07-01 支出 268 元\n"

    result = ingest_uploads([("bank.pdf", b"%PDF-1.4 fake")])

    assert len(result.texts) == 1
    assert "银行对账单" in result.texts[0]
    fake.to_markdown_bytes.assert_called_once()


def test_anydoc_pdf_scan_falls_back_to_pypdf(monkeypatch):
    """Image-only PDFs fall back to pypdf and yield the scan warning."""
    fake = _install_fake_anydoc(monkeypatch)
    fake.to_markdown_bytes.side_effect = RuntimeError("unsupported")

    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    result = ingest_uploads([("scan.pdf", buffer.getvalue())])

    assert not result.texts
    assert any("没有可提取的文本" in w for w in result.warnings)


def test_nothing_ingested():
    result = ingest_uploads([])
    assert any("没有可用的账单材料" in w for w in result.warnings)


def _install_fake_anydoc(monkeypatch) -> Mock:
    """Install a fake ``favai.ingest._anydoc`` binding and enable it."""
    fake = Mock()
    fake.format_from_extension.return_value = "docx"
    fake.format_from_bytes.return_value = None
    monkeypatch.setattr("favai.ingest._HAS_ANYDOC", True)
    monkeypatch.setattr("favai.ingest._anydoc", fake)
    return fake
