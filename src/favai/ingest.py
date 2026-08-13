"""Turn uploaded bill files into prompt text and image attachments."""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass, field
from typing import BinaryIO

from favai.ocr import ocr_available
from favai.ocr import ocr_image as _paddle_ocr

IMAGE_SUFFIXES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}
#: Plain-text formats decoded as-is.  CSV appears here as a fallback: with
#: anydoc installed it is converted to a Markdown table instead (see
#: ``ANYDOC_SUFFIXES``).
TEXT_SUFFIXES = {".txt", ".md", ".csv", ".json", ".log", ".tsv"}

#: Formats the anydoc document parser converts to Markdown (Word, PowerPoint,
#: Excel, OpenDocument, RTF, EPUB, CSV, PDF).  Install with ``pip install
#: favai[anydoc]``; the browser frontend parses these locally via WebAssembly,
#: this binding is the backend fallback.
ANYDOC_SUFFIXES = {
    ".doc",
    ".docx",
    ".docm",
    ".ppt",
    ".pps",
    ".pot",
    ".pptx",
    ".pptm",
    ".ppsx",
    ".ppsm",
    ".xls",
    ".xlsx",
    ".xlsm",
    ".xlsb",
    ".odt",
    ".ods",
    ".odp",
    ".rtf",
    ".epub",
    ".csv",
    ".pdf",
}

try:
    import anydoc as _anydoc

    _HAS_ANYDOC = True
except ImportError:
    _HAS_ANYDOC = False
    _anydoc = None  # type: ignore[assignment]

#: Below this many characters a PDF is considered a scan without text layer.
_MIN_PDF_TEXT = 20


@dataclass
class IngestResult:
    """Text blocks and image attachments extracted from uploads."""

    texts: list[str] = field(default_factory=list)
    images: list[dict[str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _pdf_text(data: BinaryIO) -> str:
    from pypdf import PdfReader

    reader = PdfReader(data)
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def anydoc_available() -> bool:
    """Return ``True`` if the anydoc document parser is installed."""
    return _HAS_ANYDOC


def _anydoc_text(filename: str, data: bytes) -> str:
    """Convert one anydoc-supported document to Markdown text.

    The format is read from the extension first (CSV has no signature and
    must be named explicitly), falling back to content detection.
    Raises the underlying anydoc exception when conversion fails.
    """
    assert _anydoc is not None
    lower = filename.lower()
    suffix = "." + lower.rsplit(".", 1)[-1] if "." in lower else ""
    fmt = _anydoc.format_from_extension(suffix) or _anydoc.format_from_bytes(data)
    if fmt is None:
        raise ValueError("无法识别的文档格式")
    return _anydoc.to_markdown_bytes(data, fmt).strip()


def ingest_file(
    filename: str, data: bytes, result: IngestResult, *, vision: bool
) -> None:
    """Classify one upload and add it to the ingest result."""
    lower = filename.lower()
    suffix = "." + lower.rsplit(".", 1)[-1] if "." in lower else ""

    image_mime = IMAGE_SUFFIXES.get(suffix)
    if image_mime:
        result.images.append(
            {"data": base64.b64encode(data).decode(), "mimeType": image_mime}
        )
        # Vision-capable models receive the original image directly.  Avoid
        # invoking OCR in that case: it adds latency and duplicates context.
        if not vision and ocr_available():
            try:
                ocr_text = _paddle_ocr(data)
            except Exception as exc:  # noqa: BLE001 - surfaced as a warning
                result.warnings.append(f"图片「{filename}」OCR 失败：{exc}")
                return
            if ocr_text:
                result.texts.append(f"--- OCR：{filename} ---\n{ocr_text}")
        return

    if suffix == ".pdf":
        _ingest_pdf(filename, data, result)
        return

    if suffix in ANYDOC_SUFFIXES and _HAS_ANYDOC:
        try:
            text = _anydoc_text(filename, data)
        except Exception as exc:  # noqa: BLE001 - surfaced as a warning
            result.warnings.append(f"文件「{filename}」解析失败：{exc}")
            return
        if text:
            result.texts.append(f"--- 文件：{filename}（anydoc 解析）---\n{text}")
        else:
            result.warnings.append(f"文件「{filename}」没有解析出内容。")
        return

    if suffix in TEXT_SUFFIXES or not suffix:
        result.texts.append(
            f"--- 文件：{filename} ---\n{data.decode('utf-8', errors='replace').strip()}"
        )
        return

    if suffix in ANYDOC_SUFFIXES:
        result.warnings.append(
            f"文件「{filename}」需要文档解析器：请运行 `pip install favai[anydoc]`。"
            "（浏览器上传时会自动使用内置的 anydoc WebAssembly 解析。）"
        )
        return

    result.warnings.append(f"不支持的文件类型：{filename}")


def _ingest_pdf(filename: str, data: bytes, result: IngestResult) -> None:
    """Extract text from a PDF, preferring anydoc over the pypdf fallback."""
    text = ""
    if _HAS_ANYDOC:
        try:
            text = _anydoc_text(filename, data)
        except Exception:  # noqa: BLE001 - e.g. image-only PDF, fall back
            text = ""
    if not text:
        try:
            text = _pdf_text(io.BytesIO(data))
        except Exception as exc:  # noqa: BLE001 - surfaced as a warning
            result.warnings.append(f"PDF「{filename}」解析失败：{exc}")
            return
    if len(text.strip()) < _MIN_PDF_TEXT:
        result.warnings.append(
            f"PDF「{filename}」没有可提取的文本（可能是扫描件），请改用页面截图上传。"
        )
        return
    label = "anydoc 解析" if _HAS_ANYDOC else "PDF 文本提取"
    result.texts.append(f"--- 文件：{filename}（{label}）---\n{text.strip()}")


def ingest_uploads(
    files: list[tuple[str, bytes]], pasted_text: str = "", *, vision: bool = False
) -> IngestResult:
    """Ingest all uploads plus an optional pasted text snippet."""
    result = IngestResult()
    if pasted_text.strip():
        result.texts.append(f"--- 用户粘贴的账单文本 ---\n{pasted_text.strip()}")
    for filename, data in files:
        ingest_file(filename, data, result, vision=vision)
    if result.images and not vision and not ocr_available():
        result.warnings.append(
            "检测到图片但未安装 OCR 引擎："
            "非 vision 模型将无法读取图片内容。"
            "请启用 vision，或运行 `pip install favai[ocr]` 安装 OCR。"
        )
    if not result.texts and not result.images:
        result.warnings.append("没有可用的账单材料：请上传文件或粘贴文本。")
    return result
