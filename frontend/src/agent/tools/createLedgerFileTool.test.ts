/**
 * Tests for the gated ``create_ledger_file`` tool.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApprovalManager } from "@/agent/approval";
import { makeBeforeToolCallGate } from "@/agent/hitl";
import { makeCreateLedgerFileTool } from "./createLedgerFileTool";
import { api } from "@/api";

vi.mock("@/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      createLedgerFile: vi.fn(),
    },
  };
});

const PARAMS = {
  path: "2026/2026-08.beancount",
  initial_content: "; August 2026\n",
  include_in_main: true,
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

async function approvedManager(): Promise<ApprovalManager> {
  vi.useFakeTimers();
  const manager = new ApprovalManager({
    ttlMs: 1000,
    mintCapability: async () => ({
      capability: "tok-1",
      expires_at: Date.now() / 1000 + 60,
    }),
  });
  const gate = makeBeforeToolCallGate(manager, {
    getLedgerId: () => "ledger-1",
    getSessionId: () => "s1",
  });
  const pending = gate({
    toolCall: { name: "create_ledger_file" } as never,
    args: PARAMS,
  } as never);
  await flush();
  manager.approve(manager.current!.id);
  await pending;
  return manager;
}

describe("create_ledger_file", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(api.createLedgerFile).mockReset();
  });

  it("cannot execute without an approval manager", async () => {
    const tool = makeCreateLedgerFileTool();
    await expect(tool.execute("c-1", PARAMS)).rejects.toThrow(/not approved/);
  });

  it("throws when the exact reviewed arguments were not approved", async () => {
    const manager = new ApprovalManager();
    const tool = makeCreateLedgerFileTool(manager);
    await expect(
      tool.execute("c-2", { ...PARAMS, path: "other.beancount" }),
    ).rejects.toThrow(/not approved/);
    expect(api.createLedgerFile).not.toHaveBeenCalled();
  });

  it("submits the reviewed operation with its single-use capability", async () => {
    const manager = await approvedManager();
    vi.mocked(api.createLedgerFile).mockResolvedValue({
      created_path: "2026/2026-08.beancount",
      include_path: "main.beancount",
      already_completed: false,
    });

    const tool = makeCreateLedgerFileTool(manager);
    const result = await tool.execute("c-3", PARAMS);

    expect(api.createLedgerFile).toHaveBeenCalledWith({
      capability: "tok-1",
      operation: PARAMS,
    });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("2026/2026-08.beancount");
  });

  it("throws on backend failure so the transcript records a tool error", async () => {
    const manager = await approvedManager();
    vi.mocked(api.createLedgerFile).mockRejectedValue(
      new Error("目标文件已存在且内容不同，拒绝覆盖"),
    );
    const tool = makeCreateLedgerFileTool(manager);
    await expect(tool.execute("c-4", PARAMS)).rejects.toThrow("拒绝覆盖");
  });
});
