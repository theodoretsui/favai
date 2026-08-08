import { beforeEach, describe, expect, it, vi } from "vitest";
import { runQuery } from "@/agent/favaApi";
import { BQL_HELP_TOPICS } from "@/agent/skills/bqlReference";
import { makeBqlHelpTool } from "./bqlHelpTool";
import { makeBqlTool } from "./bqlTool";

vi.mock("@/agent/favaApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/agent/favaApi")>();
  return {
    ...original,
    runQuery: vi.fn(),
  };
});

describe("bql_help", () => {
  it.each(BQL_HELP_TOPICS)("loads only the requested %s topic", async (topic) => {
    const result = await makeBqlHelpTool().execute("help-1", { topic });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text.length).toBeGreaterThan(100);
    expect(text).toContain("参考来源：");
    expect(result.details).toMatchObject({ topic });
  });
});

describe("bql_query", () => {
  beforeEach(() => {
    vi.mocked(runQuery).mockReset();
  });

  it("returns query metadata and forwards the abort signal", async () => {
    vi.mocked(runQuery).mockResolvedValue({
      t: "table",
      types: [{ name: "account", dtype: "str" }],
      rows: [["Expenses:Food"]],
    });
    const controller = new AbortController();

    const result = await makeBqlTool().execute(
      "query-1",
      { query: "  SELECT account  " },
      controller.signal,
    );

    expect(runQuery).toHaveBeenCalledWith("SELECT account", controller.signal);
    expect(result.details).toMatchObject({
      query: "SELECT account",
      totalRows: 1,
      returnedRows: 1,
      truncated: false,
    });
  });

  it("turns runtime failures into actionable tool errors", async () => {
    vi.mocked(runQuery).mockRejectedValue(
      new Error("Query parse error: syntax error"),
    );

    await expect(
      makeBqlTool().execute("query-2", { query: "SELECT FROM" }),
    ).rejects.toThrow(
      'BQL 查询失败：Query parse error: syntax error\n请调用 bql_help(topic="troubleshooting")',
    );
  });

  it("rejects an empty query before making a request", async () => {
    await expect(
      makeBqlTool().execute("query-3", { query: "   " }),
    ).rejects.toThrow("BQL 查询不能为空");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it.each([
    "INSERT INTO result SELECT account",
    "CREATE TABLE result AS SELECT account",
    "SELECT account; INSERT INTO result SELECT account",
    "EXPLAIN INSERT INTO result SELECT account",
  ])("rejects non-read-only or multi-statement input: %s", async (query) => {
    await expect(makeBqlTool().execute("query-4", { query })).rejects.toThrow();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("allows a semicolon inside a string literal", async () => {
    vi.mocked(runQuery).mockResolvedValue({
      t: "table",
      types: [{ name: "payee", dtype: "str" }],
      rows: [["A;B"]],
    });

    await makeBqlTool().execute("query-5", {
      query: "SELECT payee WHERE payee = 'A;B';",
    });

    expect(runQuery).toHaveBeenCalledOnce();
  });
});
