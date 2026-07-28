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
TEXT_SUFFIXES = {".txt", ".md", ".csv", ".json", ".log", ".tsv"}

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


def ingest_file(filename: str, data: bytes, result: IngestResult) -> None:
    """Classify one upload and add it to the ingest result."""
    lower = filename.lower()
    suffix = "." + lower.rsplit(".", 1)[-1] if "." in lower else ""

    image_mime = IMAGE_SUFFIXES.get(suffix)
    if image_mime:
        result.images.append(
            {"data": base64.b64encode(data).decode(), "mimeType": image_mime}
        )
        # Run OCR to extract text for non-vision models
        if ocr_available():
            try:
                ocr_text = _paddle_ocr(data)
            except Exception as exc:  # noqa: BLE001 - surfaced as a warning
                result.warnings.append(f"图片「{filename}」OCR 失败：{exc}")
                return
            if ocr_text:
                result.texts.append(f"--- OCR：{filename} ---\n{ocr_text}")
        return

    if suffix == ".pdf":
        try:
            text = _pdf_text(io.BytesIO(data))
        except Exception as exc:  # noqa: BLE001 - surfaced as a warning
            result.warnings.append(f"PDF「{filename}」解析失败：{exc}")
            return
        if len(text.strip()) < _MIN_PDF_TEXT:
            result.warnings.append(
                f"PDF「{filename}」没有可提取的文本（可能是扫描件），"
                "请改用页面截图上传。"
            )
            return
        result.texts.append(f"--- 文件：{filename}（PDF 文本提取）---\n{text.strip()}")
        return

    if suffix in TEXT_SUFFIXES or not suffix:
        result.texts.append(
            f"--- 文件：{filename} ---\n{data.decode('utf-8', errors='replace').strip()}"
        )
        return

    result.warnings.append(f"不支持的文件类型：{filename}")


def ingest_uploads(
    files: list[tuple[str, bytes]], pasted_text: str = ""
) -> IngestResult:
    """Ingest all uploads plus an optional pasted text snippet."""
    result = IngestResult()
    if pasted_text.strip():
        result.texts.append(f"--- 用户粘贴的账单文本 ---\n{pasted_text.strip()}")
    for filename, data in files:
        ingest_file(filename, data, result)
    if result.images and not ocr_available():
        result.warnings.append(
            "检测到图片但未安装 OCR 引擎："
            "非 vision 模型将无法读取图片内容。"
            "请启用 vision，或运行 `pip install favai[ocr]` 安装 OCR。"
        )
    if not result.texts and not result.images:
        result.warnings.append("没有可用的账单材料：请上传文件或粘贴文本。")
    return result
