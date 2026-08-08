import { describe, expect, it } from "vitest";
import { formatQueryResult, type QueryResultTable } from "./favaApi";

describe("formatQueryResult", () => {
  it("formats table cells and preserves structured details", () => {
    const result: QueryResultTable = {
      t: "table",
      types: [
        { name: "account", dtype: "str" },
        { name: "amount", dtype: "Amount" },
        { name: "inventory", dtype: "Inventory" },
        { name: "note", dtype: "str" },
      ],
      rows: [
        [
          "Expenses:Food",
          { number: "42.00", currency: "CNY" },
          [
            { number: "1", currency: "USD" },
            { number: "7", currency: "CNY" },
          ],
          "line 1|line 2\ncontinued",
        ],
      ],
    };

    const formatted = formatQueryResult("SELECT ...", result, 200);

    expect(formatted.text).toContain("返回：1/1 行");
    expect(formatted.text).toContain("42.00 CNY");
    expect(formatted.text).toContain("1 USD, 7 CNY");
    expect(formatted.text).toContain("line 1\\|line 2\\ncontinued");
    expect(formatted.details).toEqual({
      query: "SELECT ...",
      resultType: "table",
      columns: result.types,
      rows: result.rows,
      totalRows: 1,
      returnedRows: 1,
      truncated: false,
      maxRows: 200,
      textLength: 0,
    });
  });

  it("marks truncated results and retains only returned rows in details", () => {
    const result: QueryResultTable = {
      t: "table",
      types: [{ name: "account", dtype: "str" }],
      rows: [["A"], ["B"], ["C"]],
    };

    const formatted = formatQueryResult("SELECT account", result, 2);

    expect(formatted.text).toContain("返回：2/3 行（已截断）");
    expect(formatted.text).toContain("请增加过滤条件或 LIMIT 后重试");
    expect(formatted.details.rows).toEqual([["A"], ["B"]]);
    expect(formatted.details.truncated).toBe(true);
  });

  it("distinguishes an empty table from a failed query", () => {
    const formatted = formatQueryResult(
      "SELECT account",
      { t: "table", types: [{ name: "account", dtype: "str" }], rows: [] },
      200,
    );

    expect(formatted.text).toContain("BQL 查询成功");
    expect(formatted.text).toContain("（0 行）");
    expect(formatted.details.totalRows).toBe(0);
  });

  it("formats text statements including empty output", () => {
    const output = formatQueryResult(
      "PRINT FROM year = 2026",
      { t: "string", contents: "2026-01-01 open Assets:Bank" },
      200,
    );
    const empty = formatQueryResult(
      "PRINT FROM year = 1990",
      { t: "string", contents: "" },
      200,
    );

    expect(output.text).toContain("2026-01-01 open Assets:Bank");
    expect(output.details.textLength).toBe(27);
    expect(empty.text).toContain("查询没有返回文本");
    expect(empty.details.resultType).toBe("string");
  });
});
