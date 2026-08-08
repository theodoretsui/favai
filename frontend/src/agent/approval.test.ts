/**
 * Tests for the HITL approval manager and the ``beforeToolCall`` gate.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  ApprovalManager,
  canonicalize,
  hashCanonical,
  type ApprovalRequest,
} from "@/agent/approval";
import {
  makeBeforeToolCallGate,
  type BeforeToolCallHook,
} from "@/agent/hitl";
import {
  DEFAULT_TOOL_RISK,
  requiresApproval,
  resolveToolRisk,
} from "@/agent/risk";

const LEDGER = "/ledgers/example.beancount";

function fakeMint(): (
  request: ApprovalRequest,
) => Promise<{ capability: string; expires_at: number }> {
  return async () => ({
    capability: "tok-test",
    expires_at: Date.now() / 1000 + 60,
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  // hashCanonical() resolves through crypto.subtle, which is not timer-based;
  // advanceTimersByTimeAsync(0) yields to the event loop so it can complete.
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

describe("canonicalize and hash", () => {
  it("ignores object key order", async () => {
    const a = canonicalize({ path: "x", content: "y" });
    const b = canonicalize({ content: "y", path: "x" });
    expect(a).toBe(b);
    expect(await hashCanonical(a)).toBe(await hashCanonical(b));
  });

  it("sorts nested objects and arrays deterministically", () => {
    const a = canonicalize({ b: [1, { y: 2, x: 1 }], a: { d: 4, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 4 }, b: [1, { x: 1, y: 2 }] });
    expect(a).toBe(b);
  });
});

describe("risk registry", () => {
  it("classifies existing tools", () => {
    expect(resolveToolRisk("today", DEFAULT_TOOL_RISK).policy).toBe("read");
    expect(resolveToolRisk("bql_help").policy).toBe("read");
    expect(resolveToolRisk("bql_query").policy).toBe("read");
    expect(resolveToolRisk("propose_transactions").policy).toBe("propose");
  });

  it("fails closed for unknown tools", () => {
    expect(requiresApproval(resolveToolRisk("create_ledger_file").policy)).toBe(
      true,
    );
  });
});

describe("ApprovalManager", () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ApprovalManager({ ttlMs: 1000, mintCapability: fakeMint() });
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  it("resolves approved only after an explicit approve", async () => {
    const gate: BeforeToolCallHook = makeBeforeToolCallGate(manager, {
      getLedgerId: () => LEDGER,
      getSessionId: () => "s1",
    });
    const pending = gate({
      toolCall: { name: "create_ledger_file" } as never,
      args: { path: "a.beancount" },
    } as never);

    await flush();
    const request = manager.current;
    expect(request).not.toBeNull();
    expect(request?.toolName).toBe("create_ledger_file");
    expect(request?.sessionId).toBe("s1");

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false); // still waiting on the user

    manager.approve(request!.id);
    await pending;
    expect(settled).toBe(true);
  });

  it("blocks when denied", async () => {
    const gate: BeforeToolCallHook = makeBeforeToolCallGate(manager, {
      getLedgerId: () => LEDGER,
      getSessionId: () => undefined,
    });
    const pending = gate({
      toolCall: { name: "create_ledger_file" } as never,
      args: { path: "a.beancount" },
    } as never);
    await flush();

    manager.deny(manager.current!.id);
    const result = await pending;
    expect(result).toMatchObject({ block: true });
    expect(result?.reason).toContain("拒绝");
  });

  it("blocks when the request expires", async () => {
    const gate: BeforeToolCallHook = makeBeforeToolCallGate(manager, {
      getLedgerId: () => LEDGER,
      getSessionId: () => undefined,
    });
    const pending = gate({
      toolCall: { name: "create_ledger_file" } as never,
      args: { path: "a.beancount" },
    } as never);
    await flush();

    await vi.advanceTimersByTimeAsync(1500);
    const result = await pending;
    expect(result).toMatchObject({ block: true });
    expect(result?.reason).toContain("超时");
  });

  it("blocks when the abort signal fires", async () => {
    const controller = new AbortController();
    const gate: BeforeToolCallHook = makeBeforeToolCallGate(manager, {
      getLedgerId: () => LEDGER,
      getSessionId: () => undefined,
    });
    const pending = gate(
      {
        toolCall: { name: "create_ledger_file" } as never,
        args: { path: "a.beancount" },
      } as never,
      controller.signal,
    );
    await flush();

    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ block: true });
  });

  it("dispose fails closed for pending approvals", async () => {
    const gate: BeforeToolCallHook = makeBeforeToolCallGate(manager, {
      getLedgerId: () => LEDGER,
      getSessionId: () => undefined,
    });
    const pending = gate({
      toolCall: { name: "create_ledger_file" } as never,
      args: { path: "a.beancount" },
    } as never);
    await flush();

    manager.dispose();
    const result = await pending;
    expect(result).toMatchObject({ block: true });
  });

  it("mints a capability only on approval and hands it to execute exactly once", async () => {
    const mint = vi.fn(fakeMint());
    const m = new ApprovalManager({ ttlMs: 1000, mintCapability: mint });
    const gate: BeforeToolCallHook = makeBeforeToolCallGate(m, {
      getLedgerId: () => LEDGER,
      getSessionId: () => "s1",
    });
    const args = { path: "a.beancount", initial_content: "2026-01-01 open A" };
    const pending = gate({
      toolCall: { name: "create_ledger_file" } as never,
      args,
    } as never);
    await flush();

    m.approve(m.current!.id);
    const result = await pending;
    expect(result).toBeUndefined(); // allowed to execute

    const grant = await m.takeCapability("create_ledger_file", args);
    expect(grant).not.toBeNull();
    expect(grant?.capability).toBe("tok-test");

    // Single-use: a second take for the same args is gone.
    expect(await m.takeCapability("create_ledger_file", args)).toBeNull();

    // Changing any argument invalidates the approval.
    expect(
      await m.takeCapability("create_ledger_file", { ...args, path: "b" }),
    ).toBeNull();
    m.dispose();
  });

  it("serializes gated calls: only one request is presented at a time", async () => {
    const gate: BeforeToolCallHook = makeBeforeToolCallGate(manager, {
      getLedgerId: () => LEDGER,
      getSessionId: () => undefined,
    });
    const first = gate({
      toolCall: { name: "create_ledger_file" } as never,
      args: { path: "a" },
    } as never);
    const second = gate({
      toolCall: { name: "create_ledger_file" } as never,
      args: { path: "b" },
    } as never);
    await flush();

    expect(manager.current?.canonicalArgs).toContain("a");
    expect(manager.current?.canonicalArgs).not.toContain("b");

    manager.approve(manager.current!.id);
    await flush();

    expect(manager.current?.canonicalArgs).toContain("b");

    manager.deny(manager.current!.id);
    expect(await first).toBeUndefined();
    expect((await second)?.block).toBe(true);
  });

  it("read and propose tools never prompt", async () => {
    const gate: BeforeToolCallHook = makeBeforeToolCallGate(manager, {
      getLedgerId: () => LEDGER,
      getSessionId: () => undefined,
    });
    const readResult = await gate({
      toolCall: { name: "bql_query" } as never,
      args: { query: "SELECT *" },
    } as never);
    const proposeResult = await gate({
      toolCall: { name: "propose_transactions" } as never,
      args: { transactions: [] },
    } as never);

    expect(readResult).toBeUndefined();
    expect(proposeResult).toBeUndefined();
    expect(manager.current).toBeNull();
  });
});
