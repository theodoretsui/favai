/**
 * Inline Web Worker running the anydoc WebAssembly document parser.
 *
 * fava serves exactly one JS file per extension, so this worker is bundled
 * and base64-inlined by Vite via `?worker&inline`, and the wasm binary is
 * embedded in the same bundle via `?url` (a `data:` URL in lib mode) — no
 * separate asset that fava could not serve. The worker decodes the bytes and
 * instantiates them synchronously with `initSync`.
 *
 * Message protocol (main thread → worker):
 *   { type: "init" }                     — instantiate the wasm module once
 *   { type: "convert"; id: number; name: string; bytes: ArrayBuffer;
 *     format?: Format | null }            — convert a document to Markdown
 *
 * Responses:
 *   { type: "ready" } | { type: "init-error"; message: string }
 *   { type: "ok"; id; name; markdown } | { type: "error"; id; name;
 *     code?: string; message: string }
 */
import wasmDataUrl from "@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm?url";
import {
  initSync,
  formatFromExtension,
  toMarkdownBytes,
} from "@firecrawl/anydoc-wasm";
import type { Format } from "@firecrawl/anydoc-wasm";

interface InitMessage {
  type: "init";
}

interface ConvertMessage {
  type: "convert";
  id: number;
  name: string;
  bytes: ArrayBuffer;
  format?: Format | null;
}

type WorkerMessage = InitMessage | ConvertMessage;

interface OkResponse {
  type: "ok";
  id: number;
  name: string;
  markdown: string;
}

interface ErrorResponse {
  type: "error";
  id: number;
  name: string;
  code?: string;
  message: string;
}

type ConvertResponse = OkResponse | ErrorResponse;

const ctx = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

let initialized = false;

function post(message: unknown): void {
  ctx.postMessage(message);
}

/** Decode a `data:application/wasm;base64,…` URL into raw bytes. */
function decodeWasm(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function ensureInitialized(): string | null {
  if (initialized) return null;
  try {
    initSync(decodeWasm(wasmDataUrl));
    initialized = true;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

ctx.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    const error = ensureInitialized();
    post(error ? { type: "init-error", message: error } : { type: "ready" });
    return;
  }
  if (message.type === "convert") {
    post(convert(message));
  }
};

function convert(message: ConvertMessage): ConvertResponse {
  const initError = ensureInitialized();
  if (initError) {
    return {
      type: "error",
      id: message.id,
      name: message.name,
      message: `anydoc init failed: ${initError}`,
    };
  }
  try {
    // Extension-derived format when available (CSV has no signature and must
    // be named explicitly); otherwise let anydoc detect from content.
    const format = message.format ?? formatFromExtension(message.name);
    const markdown = toMarkdownBytes(new Uint8Array(message.bytes), format);
    return { type: "ok", id: message.id, name: message.name, markdown };
  } catch (error) {
    const err = error as { code?: unknown };
    const code = typeof err.code === "string" ? err.code : undefined;
    return {
      type: "error",
      id: message.id,
      name: message.name,
      code,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
