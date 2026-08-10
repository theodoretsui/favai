/**
 * Tests for the v2 proposal tools: complete-batch contract, typed schema,
 * and fail-closed backend behavior.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import { makeProposeTransactionsTool } from "./proposeTransactionsTool";
import { makeProposeDirectivesTool } from "./proposeDirectivesTool";

vi.mock("@/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      proposalPreview: vi.fn(),
    },
  };
});

const CHANGE_SET = {
  id: "cs1",
  revision: 3,
  transaction_count: 2,
  directive_count: 0,
  transactions: [],
  directives: [],
  target_file: "2026.beancount",
  preview: "2026-01-02 * \"\" \"lunch\"",
  errors: [],
  warnings: [],
};

const SIMPLE_TXN = {
  date: "2026-01-02",
  flag: "complete" as const,
  narration: "lunch",
  postings: [
    { account: "Expenses:Food", units: { number: "50", currency: "CNY" } },
    { account: "Assets:CN:Bank", units: { number: "-50", currency: "CNY" } },
  ],
};

function callbacks() {
  const onProposal = vi.fn();
  const getSessionId = vi.fn(() => "s1");
  return { onProposal, getSessionId };
}

describe("propose_transactions v2", () => {
  beforeEach(() => {
    vi.mocked(api.proposalPreview).mockReset();
  });

  it("submits the whole batch and reports the accepted change set", async () => {
    vi.mocked(api.proposalPreview).mockResolvedValue(CHANGE_SET);
    const { onProposal, getSessionId } = callbacks();
    const tool = makeProposeTransactionsTool(onProposal, getSessionId);

    const result = await tool.execute("tc-1", {
      transactions: [SIMPLE_TXN, { ...SIMPLE_TXN, narration: "dinner" }],
    });

    expect(api.proposalPreview).toHaveBeenCalledWith(
      "transactions",
      { transactions: expect.any(Array) },
      "s1",
    );
    const batch = vi.mocked(api.proposalPreview).mock.calls[0][1] as {
      transactions: typeof SIMPLE_TXN[];
    };
    expect(batch.transactions).toHaveLength(2); // complete batch
    expect(onProposal).toHaveBeenCalledWith(CHANGE_SET);
    expect(result.details).toMatchObject({ changeSet: CHANGE_SET });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("2026-01-02");
  });

  it("normalizes flags and strips tag prefixes", async () => {
    vi.mocked(api.proposalPreview).mockResolvedValue(CHANGE_SET);
    const tool = makeProposeTransactionsTool(callbacks().onProposal, callbacks().getSessionId);
    await tool.execute("tc-2", {
      transactions: [{ ...SIMPLE_TXN, tags: ["#food", "reimbursable"] }],
    });
    const batch = vi.mocked(api.proposalPreview).mock.calls[0][1] as {
      transactions: { tags?: string[]; flag?: string }[];
    };
    expect(batch.transactions[0].tags).toEqual(["food", "reimbursable"]);
    expect(batch.transactions[0].flag).toBe("complete");
  });

  it("throws on backend failure so the transcript records a tool error", async () => {
    vi.mocked(api.proposalPreview).mockRejectedValue(
      new Error("Invalid reference to unknown account 'Assets:New'"),
    );
    const tool = makeProposeTransactionsTool(callbacks().onProposal, callbacks().getSessionId);
    await expect(
      tool.execute("tc-3", { transactions: [SIMPLE_TXN] }),
    ).rejects.toThrow("unknown account");
  });
});

describe("propose_directives", () => {
  beforeEach(() => {
    vi.mocked(api.proposalPreview).mockReset();
  });

  it("submits the typed directive batch", async () => {
    vi.mocked(api.proposalPreview).mockResolvedValue({
      ...CHANGE_SET,
      transaction_count: 0,
      directive_count: 1,
    });
    const { onProposal, getSessionId } = callbacks();
    const tool = makeProposeDirectivesTool(onProposal, getSessionId);

    await tool.execute("dc-1", {
      directives: [
        { kind: "open", date: "2026-01-01", account: "Assets:New", currencies: ["CNY"] },
      ],
    });

    expect(api.proposalPreview).toHaveBeenCalledWith(
      "directives",
      { directives: [{ kind: "open", account: "Assets:New", currencies: ["CNY"], date: "2026-01-01" }] },
      "s1",
    );
    expect(onProposal).toHaveBeenCalledTimes(1);
  });
});
