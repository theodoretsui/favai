/**
 * Tests for the anydoc classification helpers.
 */

import { describe, expect, it } from "vitest";
import {
  ANYDOC_EXTENSIONS,
  classifyFile,
  documentTextBlock,
  fileExtension,
} from "@/lib/anydocCore";

describe("fileExtension", () => {
  it("lowercases and strips the path", () => {
    expect(fileExtension("BILL.DOCX")).toBe("docx");
    expect(fileExtension("dir/statement.pdf")).toBe("pdf");
    expect(fileExtension("noext")).toBe("");
  });
});

describe("classifyFile", () => {
  it("keeps images for the backend pipeline", () => {
    expect(classifyFile("receipt.PNG")).toEqual({ kind: "image" });
    expect(classifyFile("photo.jpeg")).toEqual({ kind: "image" });
  });

  it("keeps plain text for the backend pipeline", () => {
    expect(classifyFile("notes.txt")).toEqual({ kind: "text" });
    expect(classifyFile("ledger.json")).toEqual({ kind: "text" });
  });

  it("maps office documents to anydoc formats", () => {
    expect(classifyFile("bill.docx")).toEqual({ kind: "anydoc", format: "docx" });
    expect(classifyFile("bill.doc")).toEqual({ kind: "anydoc", format: "doc" });
    expect(classifyFile("slides.pptx")).toEqual({ kind: "anydoc", format: "pptx" });
    expect(classifyFile("data.xls")).toEqual({ kind: "anydoc", format: "xlsx" });
    expect(classifyFile("book.epub")).toEqual({ kind: "anydoc", format: "epub" });
    expect(classifyFile("ledger.csv")).toEqual({ kind: "anydoc", format: "csv" });
    expect(classifyFile("bill.pdf")).toEqual({ kind: "anydoc", format: "pdf" });
  });

  it("covers every declared anydoc extension", () => {
    for (const ext of ANYDOC_EXTENSIONS) {
      const cls = classifyFile(`file.${ext}`);
      expect(cls.kind).toBe("anydoc");
      expect(cls.kind === "anydoc" ? cls.format : null).toBeTruthy();
    }
  });

  it("marks unknown extensions as unknown", () => {
    expect(classifyFile("archive.zip")).toEqual({ kind: "unknown" });
    expect(classifyFile("script.py")).toEqual({ kind: "unknown" });
  });
});

describe("documentTextBlock", () => {
  it("wraps markdown with the file header", () => {
    expect(documentTextBlock("bill.docx", "# Title")).toBe(
      "--- 文件：bill.docx（anydoc 解析）---\n# Title",
    );
  });
});
