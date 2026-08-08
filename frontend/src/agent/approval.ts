/**
 * Human-in-the-loop approval state for gated tool calls.
 *
 * The ``ApprovalManager`` owns pending approval requests as application
 * state — never as model-generated transcript messages, and never persisted
 * into conversation history. An approval is bound to the tool name, risk
 * policy, canonical serialized arguments (and their SHA-256 hash), the
 * current ledger, the conversation session, a short expiration, and a
 * single-use request id. Changing any argument changes the hash and
 * invalidates the approval; one approval never authorizes later calls.
 *
 * All outcomes other than an explicit UI approval fail closed: denial,
 * expiry, abort, dispose (component teardown), and page refresh (the manager
 * is in-memory only) all block the tool call.
 */

import { api } from "@/api";
import type { ToolRiskPolicy } from "@/agent/risk";

export const DEFAULT_APPROVAL_TTL_MS = 120_000;

/** Serialize arguments deterministically: object keys are sorted deeply. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortDeep(record[key])]),
    );
  }
  return value;
}

/** SHA-256 hex digest of the canonical argument serialization. */
export async function hashCanonical(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface ApprovalRequest {
  /** Single-use identifier; ``approve``/``deny`` only work once, on this id. */
  id: string;
  toolName: string;
  policy: Extract<ToolRiskPolicy, "write" | "destructive">;
  args: unknown;
  canonicalArgs: string;
  /** SHA-256 hex of ``canonicalArgs`` — also the backend operation hash. */
  argsHash: string;
  ledgerId: string;
  sessionId?: string;
  /** Optional i18n key describing the expected effects of this operation. */
  effectKey?: string;
  /** Epoch ms when this request stops accepting decisions. */
  expiresAt: number;
}

export type ApprovalOutcome =
  | "approved"
  | "denied"
  | "cancelled"
  | "expired"
  | "error";

export interface ApprovalDecision {
  outcome: ApprovalOutcome;
  /** Backend capability token minted on approval (single-use, expiring). */
  capability?: string;
  capabilityExpiresAt?: number;
  /** Human-readable reason for non-approved outcomes. */
  reason?: string;
}

interface ApprovalInput {
  toolName: string;
  policy: Extract<ToolRiskPolicy, "write" | "destructive">;
  args: unknown;
  ledgerId: string;
  sessionId?: string;
  effectKey?: string;
}

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface ApprovalManagerOptions {
  /** How long a presented request waits for a decision before expiring. */
  ttlMs?: number;
  now?: () => number;
  randomId?: () => string;
  /** Injectable capability minting; defaults to the backend endpoint. */
  mintCapability?: (
    request: ApprovalRequest,
  ) => Promise<{ capability: string; expires_at: number }>;
}

export class ApprovalManager {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly mintCapability: NonNullable<
    ApprovalManagerOptions["mintCapability"]
  >;
  private pending: PendingEntry | null = null;
  /** Serializes gated calls: each request is presented only after the
   *  previous one settled, so simultaneous calls are approved one by one. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<
    (request: ApprovalRequest | null) => void
  >();
  /** Minted backend capabilities awaiting consumption by the gated tool,
   *  keyed by ``toolName:argsHash``. Never persisted anywhere. */
  private readonly capabilities = new Map<
    string,
    { capability: string; expiresAt: number }
  >();
  private disposed = false;

  constructor(options: ApprovalManagerOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.mintCapability =
      options.mintCapability ??
      ((request) =>
        api.mintCapability(request.args, request.sessionId));
  }

  /** Current pending request, or null. Only one request is shown at a time. */
  get current(): ApprovalRequest | null {
    return this.pending?.request ?? null;
  }

  /** Subscribe to pending-request changes for rendering the approval UI. */
  subscribe(listener: (request: ApprovalRequest | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const request = this.current;
    for (const listener of this.listeners) {
      listener(request);
    }
  }

  /**
   * Request an explicit user decision for one gated tool call.
   *
   * Called from the ``beforeToolCall`` gate after argument validation.
   * Resolves only when the user approves/denies, the request expires, the
   * abort signal fires, or the manager is disposed — all but ``approved``
   * must be treated as "block the call".
   */
  async requestApproval(
    input: ApprovalInput,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    const canonicalArgs = canonicalize(input.args);
    const request: ApprovalRequest = {
      id: this.randomId(),
      toolName: input.toolName,
      policy: input.policy,
      args: input.args,
      canonicalArgs,
      argsHash: await hashCanonical(canonicalArgs),
      ledgerId: input.ledgerId,
      sessionId: input.sessionId,
      effectKey: input.effectKey,
      expiresAt: 0, // Set when the request is actually presented.
    };
    if (this.disposed || signal?.aborted) {
      return this.blockedDecision("cancelled");
    }
    // Chain onto the queue so only one request waits on the user at a time.
    const decision = this.queue.then(() => this.present(request, signal));
    this.queue = decision.catch(() => undefined);
    return decision;
  }

  /** Approve the pending request. Only valid once, for the current id. */
  approve(id: string): void {
    void this.settle(id, "approved");
  }

  /** Deny the pending request. Only valid once, for the current id. */
  deny(id: string): void {
    void this.settle(id, "denied");
  }

  private present(
    request: ApprovalRequest,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    if (this.disposed || signal?.aborted) {
      return Promise.resolve(this.blockedDecision("cancelled"));
    }
    return new Promise<ApprovalDecision>((resolve) => {
      const entry: PendingEntry = {
        request,
        resolve,
        timer: setTimeout(
          () => void this.settle(request.id, "expired"),
          this.ttlMs,
        ),
        signal,
      };
      if (signal) {
        entry.onAbort = () => void this.settle(request.id, "cancelled");
        signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      request.expiresAt = this.now() + this.ttlMs;
      this.pending = entry;
      this.notify();
    });
  }

  private async settle(
    id: string,
    outcome: "approved" | "denied" | "cancelled" | "expired",
  ): Promise<void> {
    const entry = this.pending;
    if (!entry || entry.request.id !== id) return; // single-use / stale id
    // Clear pending synchronously so a double-settle can never slip through.
    this.pending = null;
    clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener("abort", entry.onAbort);
    }
    this.notify();
    if (outcome !== "approved") {
      entry.resolve(this.blockedDecision(outcome));
      return;
    }
    try {
      const grant = await this.mintCapability(entry.request);
      this.capabilities.set(this.capabilityKey(entry.request), {
        capability: grant.capability,
        expiresAt: grant.expires_at * 1000,
      });
      entry.resolve({
        outcome: "approved",
        capability: grant.capability,
        capabilityExpiresAt: grant.expires_at * 1000,
      });
    } catch (error) {
      // Fail closed: without a backend capability the call must not run.
      entry.resolve({
        outcome: "error",
        reason: `授权凭证签发失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  private blockedDecision(
    outcome: Exclude<ApprovalOutcome, "approved" | "error">,
  ): ApprovalDecision {
    const reasons = {
      denied: "用户拒绝了该操作，本次调用未执行。",
      cancelled: "操作已取消，本次调用未执行。",
      expired: "等待用户确认超时，本次调用未执行。",
    } as const;
    return { outcome, reason: reasons[outcome] };
  }

  private capabilityKey(request: ApprovalRequest): string {
    return `${request.toolName}:${request.argsHash}`;
  }

  /**
   * Take the minted capability for exactly these arguments (single-use).
   *
   * Gated write tools call this inside ``execute`` to obtain the backend
   * capability to send along. Returns null when no valid approval exists —
   * the tool must then throw so the agent records a tool error.
   */
  async takeCapability(
    toolName: string,
    args: unknown,
  ): Promise<{ capability: string; argsHash: string } | null> {
    const argsHash = await hashCanonical(canonicalize(args));
    const key = `${toolName}:${argsHash}`;
    const grant = this.capabilities.get(key) ?? null;
    if (grant) {
      this.capabilities.delete(key); // single-use, even if expired
    }
    if (!grant || grant.expiresAt <= this.now()) {
      return null;
    }
    return { capability: grant.capability, argsHash };
  }

  /** Teardown: cancel the pending request and drop every stored grant. */
  dispose(): void {
    this.disposed = true;
    const entry = this.pending;
    this.pending = null;
    if (entry) {
      clearTimeout(entry.timer);
      if (entry.signal && entry.onAbort) {
        entry.signal.removeEventListener("abort", entry.onAbort);
      }
      this.notify();
      entry.resolve(this.blockedDecision("cancelled"));
    }
    this.capabilities.clear();
    this.listeners.clear();
  }
}
