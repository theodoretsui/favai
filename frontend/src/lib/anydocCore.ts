/**
 * Pure classification helpers for the anydoc document parser.
 *
 * Kept free of Worker/WebAssembly imports so it can be unit-tested in Node.
 */

export type Format =
  | "doc"
  | "docx"
  | "odt"
  | "pdf"
  | "ppt"
  | "pptx"
  | "rtf"
  | "epub"
  | "xlsx"
  | "ods"
  | "odp"
  | "csv";

/**
 * Extensions anydoc can convert to Markdown. Container variants that share a
 * parser (`.docm`, `.xlsm`, `.ppsx`, ...) map onto the `Format` above.
 */
export const ANYDOC_EXTENSIONS: ReadonlySet<string> = new Set([
  // Word
  "doc",
  "docx",
  "docm",
  // PowerPoint
  "ppt",
  "pps",
  "pot",
  "pptx",
  "pptm",
  "ppsx",
  "ppsm",
  // Excel
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  // OpenDocument
  "odt",
  "ods",
  "odp",
  // Others
  "rtf",
  "epub",
  "csv",
  "pdf",
]);

/** Formats handled by the existing backend pipeline (images / plain text). */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
]);

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "txt",
  "md",
  "json",
  "log",
  "tsv",
]);

/** Extension → anydoc format name, matching `formatFromExtension`. */
const FORMAT_BY_EXTENSION: Record<string, Format> = {
  doc: "doc",
  docx: "docx",
  docm: "doc",
  ppt: "ppt",
  pps: "ppt",
  pot: "ppt",
  pptx: "pptx",
  pptm: "pptx",
  ppsx: "pptx",
  ppsm: "pptx",
  xls: "xlsx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  xlsb: "xlsx",
  odt: "odt",
  ods: "ods",
  odp: "odp",
  rtf: "rtf",
  epub: "epub",
  csv: "csv",
  pdf: "pdf",
};

export type FileKind =
  | { kind: "image" }
  | { kind: "text" }
  | { kind: "anydoc"; format: Format }
  | { kind: "unknown" };

export function fileExtension(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot + 1) : "";
}

/** Classify one uploaded file for the anydoc pipeline. */
export function classifyFile(name: string): FileKind {
  const ext = fileExtension(name);
  if (IMAGE_EXTENSIONS.has(ext)) return { kind: "image" };
  if (TEXT_EXTENSIONS.has(ext)) return { kind: "text" };
  const format = FORMAT_BY_EXTENSION[ext];
  if (format) return { kind: "anydoc", format };
  return { kind: "unknown" };
}

/** Header used on every document text block, mirroring the backend style. */
export function documentTextBlock(name: string, markdown: string): string {
  return `--- 文件：${name}（anydoc 解析）---\n${markdown}`;
}
