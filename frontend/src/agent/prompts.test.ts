import { describe, expect, it } from "vitest";
import { CHAT_SYSTEM_PROMPT, UNIFIED_SYSTEM_PROMPT } from "./prompts";

describe("BQL system prompt guidance", () => {
  it.each([CHAT_SYSTEM_PROMPT, UNIFIED_SYSTEM_PROMPT])(
    "uses the local help tool and correct filter semantics",
    (prompt) => {
      expect(prompt).toContain("bql_help");
      expect(prompt).toContain("FROM 过滤完整 entry/transaction");
      expect(prompt).toContain("WHERE 过滤 posting");
      expect(prompt).toContain("BQL 没有 HAVING");
      expect(prompt).not.toContain("SELECT ... FROM 是标准查询格式");
    },
  );

  it("allows read-before-propose workflows in the unified agent", () => {
    expect(UNIFIED_SYSTEM_PROMPT).toContain(
      "可以先调用 bql_query，再调用 propose_transactions",
    );
    expect(UNIFIED_SYSTEM_PROMPT).not.toContain(
      "不要在同一条消息中同时支持两个功能",
    );
  });
});
