/**
 * Browser-side document parsing powered by anydoc (WebAssembly).
 *
 * Converts Word / PowerPoint / Excel / OpenDocument / RTF / EPUB / CSV / PDF
 * uploads into Markdown locally, before anything is sent to the backend. The
 * wasm binary ships embedded in the frontend bundle and runs inside an inline
 * Web Worker, so large files never block the UI.
 *
 * Files anydoc cannot or should not handle (images, plain text) are passed
 * through unchanged so the backend pipeline (vision / OCR / text decode) keeps
 * working as before.
 */
import { t } from "@/i18n";
import AnyDocWorker from "./anydocWorker?worker&inline";
import {
  classifyFile,
  documentTextBlock,
  type Format,
} from "./anydocCore";

export interface ConvertResult {
  /** Markdown text blocks extracted from documents, ready for the agent. */
  texts: string[];
  /** Files the backend should still receive (images, plain text, failures). */
  uploads: File[];
  /** User-facing warnings surfaced before the agent prompt is built. */
  warnings: string[];
}

interface PendingRequest {
  resolve: (markdown: string) => void;
  reject: (error: Error) => void;
}

let workerPromise: Promise<Worker> | null = null;
let requestId = 0;
const pending = new Map<number, PendingRequest>();

function getWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const worker = new AnyDocWorker();
    worker.onmessage = handleResponse;
    await initWorker(worker);
    return worker;
  })();
  // A failed init must be retryable on the next upload.
  workerPromise.catch(() => {
    workerPromise = null;
  });
  return workerPromise;
}

/** Wait for the worker's "ready" signal after it instantiates the wasm. */
function initWorker(worker: Worker): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type: string; message?: string };
      worker.removeEventListener("message", onMessage);
      if (message.type === "ready") {
        resolve();
      } else {
        reject(new Error(message.message ?? "anydoc init failed"));
      }
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "init" });
  });
}

function handleResponse(event: MessageEvent): void {
  const message = event.data as {
    type: string;
    id?: number;
    markdown?: string;
    code?: string;
    message?: string;
  };
  if (message.type !== "ok" && message.type !== "error") return;
  if (typeof message.id !== "number") return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.type === "ok") {
    entry.resolve(message.markdown ?? "");
  } else {
    const error = new Error(message.message ?? "conversion failed");
    if (message.code) {
      (error as { code?: string }).code = message.code;
    }
    entry.reject(error);
  }
}

function convertInWorker(
  worker: Worker,
  name: string,
  bytes: ArrayBuffer,
  format: Format | null,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: "convert", id, name, bytes, format }, [bytes]);
  });
}

/**
 * Convert every anydoc-supported upload to Markdown locally.
 *
 * Images and plain-text files are returned unchanged. Documents that fail to
 * convert (encrypted, scanned PDFs, …) are also returned so the backend can
 * produce its usual warning; the browser never loses a file.
 */
export async function convertDocuments(files: File[]): Promise<ConvertResult> {
  const anydocFiles: { file: File; format: Format | null }[] = [];
  const uploads: File[] = [];
  for (const file of files) {
    const cls = classifyFile(file.name);
    if (cls.kind === "anydoc") {
      anydocFiles.push({ file, format: cls.format });
    } else {
      uploads.push(file);
    }
  }
  if (anydocFiles.length === 0) {
    return { texts: [], uploads, warnings: [] };
  }

  let worker: Worker;
  try {
    worker = await getWorker();
  } catch {
    // anydoc unavailable (wasm fetch failed, worker crashed): hand every file
    // to the backend unchanged; it may still parse with its Python binding.
    return {
      texts: [],
      uploads: files,
      warnings: [t("import.anydoc.unavailable")],
    };
  }

  const texts: string[] = [];
  const warnings: string[] = [];
  for (const { file, format } of anydocFiles) {
    try {
      const bytes = await file.arrayBuffer();
      const markdown = (
        await convertInWorker(worker, file.name, bytes, format)
      ).trim();
      if (markdown) {
        texts.push(documentTextBlock(file.name, markdown));
      } else {
        warnings.push(t("import.anydoc.empty", { name: file.name }));
        uploads.push(file);
      }
    } catch {
      // Leave the failure to the backend (it may have the anydoc Python
      // binding, or it will report a clear unsupported-file warning).
      uploads.push(file);
    }
  }
  return { texts, uploads, warnings };
}
