/**
 * API client for the favai backend.
 *
 * The backend endpoints live at the extension page URL itself, so the base
 * path is simply window.location.pathname (it always ends with "/").
 */

export interface Status {
  configured: boolean;
  ocr_available: boolean;
  source_files: string[];
  default_write_path: string;
}

export type ApiKind = "openai-completions" | "anthropic-messages";

export interface Config {
  provider: string;
  api: ApiKind;
  base_url: string;
  model: string;
  models: string[];
  api_key: string;
  api_key_stored: boolean;
  vision: boolean;
  context_window: number;
  max_tokens: number;
}

export interface BookkeepingHabits {
  bookkeeping_habits: string;
}

export interface PostingUnits {
  number: string;
  currency: string;
}

export interface PostingCost {
  kind: "per_unit" | "total" | "compound";
  number?: string;
  per_number?: string;
  total_number?: string;
  currency: string;
  date?: string;
}

export interface PostingPrice {
  kind: "per_unit" | "total";
  number: string;
  currency: string;
}

export interface Posting {
  account: string;
  flag?: string;
  units?: PostingUnits;
  cost?: PostingCost;
  price?: PostingPrice;
  metadata?: Record<string, string | number | boolean>;
}

export interface Transaction {
  date: string;
  flag?: "complete" | "incomplete";
  payee?: string;
  narration: string;
  postings: Posting[];
  tags?: string[];
  links?: string[];
  metadata?: Record<string, string | number | boolean>;
}

export interface Directive {
  kind: "open" | "commodity" | "price" | "balance" | "note" | "event";
  date: string;
  account?: string;
  currency?: string;
  currencies?: string[];
  booking?: string;
  commodity?: string;
  amount?: { number: string; currency: string };
  comment?: string;
  type?: string;
  description?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface ChangeSetPreview {
  id: string;
  revision: number;
  transaction_count: number;
  directive_count: number;
  target_file: string | null;
  preview: string;
  errors: string[];
  warnings: string[];
}

export interface ImportConfirmResult {
  inserted: number;
  write_path: string | null;
}

export interface CapabilityGrant {
  capability: string;
  operation_hash: string;
  risk: string;
  expires_at: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  revision: number;
  model_provider: string;
  model_api: string;
  model_name: string;
  has_proposal: number;
  proposal_dirty: number;
  confirmed_at: string | null;
  confirmed_count: number | null;
}

export interface Session extends Omit<SessionSummary, "has_proposal"> {
  messages: unknown[];
  proposal: Transaction[] | null;
  pending_proposal: Transaction[] | null;
  confirmed_transactions: Transaction[];
}

export interface SessionListResult {
  sessions: SessionSummary[];
  has_more: boolean;
}

export interface SessionSave {
  session_id: string;
  expected_revision: number;
  messages: unknown[];
  proposal: Transaction[] | null;
  proposal_dirty: boolean;
  pending_proposal: Transaction[] | null;
  title?: string;
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
  getBookkeepingHabits: () =>
    request<BookkeepingHabits>("bookkeeping_habits"),
  saveBookkeepingHabits: (bookkeeping_habits: string) =>
    postJson<BookkeepingHabits>("bookkeeping_habits", {
      bookkeeping_habits,
    }),
  listProviderConfigs: () => request<Config[]>("provider_configs"),
  deleteProviderConfig: (provider: string) =>
    postJson<{ deleted: boolean }>("provider_config_delete", { provider }),
  listModels: (config?: Config, provider?: string) =>
    config
      ? postJson<{ models: string[] }>("models", config)
      : request<{ models: string[] }>(
          `models${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`,
        ),
  ingest: (files: File[], text: string, vision: boolean) => {
    const form = new FormData();
    for (const file of files) {
      form.append("files", file, file.name);
    }
    form.append("text", text);
    form.append("vision", String(vision));
    return request<IngestResult>("ingest", {
      method: "POST",
      body: form,
    });
  },
  importConfirm: (
    transactions: Transaction[],
    sessionId?: string,
    writePath?: string,
  ) =>
    postJson<ImportConfirmResult>("import_confirm", {
      transactions,
      session_id: sessionId,
      write_path: writePath,
    }),
  proposalPreview: (
    tool: "transactions" | "directives",
    batch: { transactions?: Transaction[]; directives?: Directive[] },
    sessionId?: string,
    writePath?: string,
  ) =>
    postJson<ChangeSetPreview>("proposal_preview", {
      session_id: sessionId,
      tool,
      batch,
      write_path: writePath,
    }),
  getProposal: (sessionId?: string) =>
    request<ChangeSetPreview>(
      `proposal_preview?session_id=${encodeURIComponent(sessionId ?? "")}`,
    ),
  proposalConfirm: (sessionId: string, revision: number, writePath?: string) =>
    postJson<ImportConfirmResult>("proposal_confirm", {
      session_id: sessionId,
      revision,
      write_path: writePath,
    }),
  createLedgerFile: (payload: {
    capability: string;
    operation: {
      path: string;
      initial_content: string;
      include_in_main: boolean;
    };
    sessionId?: string;
  }) =>
    postJson<{
      created_path: string;
      include_path: string;
      already_completed: boolean;
    }>("ledger_file_create", {
      capability: payload.capability,
      operation: payload.operation,
      session_id: payload.sessionId,
    }),
  listSessions: (offset = 0, limit = 30) =>
    request<SessionListResult>(`sessions?limit=${limit}&offset=${offset}`),
  createSession: (config: Config) =>
    postJson<Session>("sessions", {
      model_provider: config.provider,
      model_api: config.api,
      model_name: config.model,
    }),
  getSession: (sessionId: string) =>
    request<Session>(`session?session_id=${encodeURIComponent(sessionId)}`),
  renameSession: (sessionId: string, title: string) =>
    postJson<Session>("session", { session_id: sessionId, title }),
  saveSession: (state: SessionSave) =>
    postJson<Session>("session_save", state),
  deleteSession: (sessionId: string) =>
    postJson<{ deleted: boolean }>("session_delete", {
      session_id: sessionId,
    }),
  mintCapability: (operation: unknown, sessionId?: string) =>
    postJson<CapabilityGrant>("capability_mint", {
      operation,
      session_id: sessionId,
    }),
};
