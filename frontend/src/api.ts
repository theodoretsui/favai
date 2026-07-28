/**
 * API client for the favai backend.
 *
 * The backend endpoints live at the extension page URL itself, so the base
 * path is simply window.location.pathname (it always ends with "/").
 */

export interface Status {
  configured: boolean;
  ocr_available: boolean;
}

export type ApiKind = "openai-completions" | "anthropic-messages";

export interface Config {
  api: ApiKind;
  base_url: string;
  model: string;
  api_key: string;
  api_key_stored: boolean;
  vision: boolean;
  context_window: number;
  max_tokens: number;
}

export interface Posting {
  account: string;
  amount?: string;
  currency?: string;
}

export interface Transaction {
  date: string;
  payee?: string;
  narration: string;
  postings: Posting[];
  tags?: string[];
  links?: string[];
}

export interface ImportConfirmResult {
  inserted: number;
}

export interface IngestResult {
  texts: string[];
  images: { data: string; mimeType: string }[];
  warnings: string[];
}

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function getBaseUrl(): string {
  const p = window.location.pathname;
  return p.endsWith("/") ? p : `${p}/`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(getBaseUrl() + path, init);
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`HTTP ${res.status}`);
  }
  if (!body.success) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return body.data;
}

function postJson<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export const api = {
  status: () => request<Status>("status"),
  getConfig: () => request<Config>("config"),
  saveConfig: (config: Config) => postJson<Config>("config", config),
  ingest: (files: File[], text: string) => {
    const form = new FormData();
    for (const file of files) {
      form.append("files", file, file.name);
    }
    form.append("text", text);
    return request<IngestResult>("ingest", {
      method: "POST",
      body: form,
    });
  },
  importConfirm: (transactions: Transaction[]) =>
    postJson<ImportConfirmResult>("import_confirm", { transactions }),
};
