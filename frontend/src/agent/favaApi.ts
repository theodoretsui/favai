/**
 * Fava built-in API access.
 *
 * Uses ``#ledger-data`` (injected into every fava page) for zero-request
 * context and the JSON API for queries.
 */

export interface LedgerData {
  accounts: string[];
  payees: string[];
  currencies: string[];
  operatingCurrency: string[];
  baseUrl: string;
}

export function getLedgerData(): LedgerData {
  const el = document.getElementById("ledger-data");
  if (!el?.textContent) {
    throw new Error("ledger-data 元素未找到");
  }
  const raw = JSON.parse(el.textContent);
  const accounts: string[] = raw.accounts ?? [];
  const payees: string[] = (raw.payees ?? []).slice(-200);
  const currencies: string[] = raw.currencies ?? [];
  const operatingCurrency: string[] = raw.options?.operating_currency ?? [];
  const baseUrl: string = raw.base_url ?? "/";
  return { accounts, payees, currencies, operatingCurrency, baseUrl };
}

export interface QueryResultTable {
  t: "table";
  types: { name: string; dtype: string }[];
  rows: unknown[][];
}

export interface QueryResultString {
  t: "string";
  contents: string;
}

export type QueryResult = QueryResultTable | QueryResultString;

/**
 * Run a BQL query against the fava API.
 */
export async function runQuery(
  bql: string,
  signal?: AbortSignal,
): Promise<QueryResult> {
  const { baseUrl } = getLedgerData();
  const url = `${baseUrl}api/query?query_string=${encodeURIComponent(bql)}`;
  const res = await fetch(url, { signal });
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data as QueryResult;
}

/** Metadata retained with a formatted BQL tool result. */
export interface QueryResultDetails {
  query: string;
  resultType: QueryResult["t"];
  columns: { name: string; dtype: string }[];
  rows: unknown[][];
  totalRows: number;
  returnedRows: number;
  truncated: boolean;
  maxRows: number;
  textLength: number;
}

export interface FormattedQueryResult {
  text: string;
  details: QueryResultDetails;
}

/** Format a query response for both model context and structured tool details. */
export function formatQueryResult(
  query: string,
  result: QueryResult,
  maxRows = 200,
): FormattedQueryResult {
  const rowLimit = Math.max(0, Math.floor(maxRows));

  if (result.t === "string") {
    const contents = result.contents || "（查询没有返回文本）";
    return {
      text: `BQL 查询成功。\n查询：${query}\n\n${contents}`,
      details: {
        query,
        resultType: "string",
        columns: [],
        rows: [],
        totalRows: 0,
        returnedRows: 0,
        truncated: false,
        maxRows: rowLimit,
        textLength: result.contents.length,
      },
    };
  }

  const table = result;
  const rows = table.rows.slice(0, rowLimit);
  const truncated = table.rows.length > rows.length;
  const lines: string[] = [];
  const colNames = table.types.map((t) => t.name);
  lines.push("BQL 查询成功。");
  lines.push(`查询：${query}`);
  lines.push(
    `返回：${rows.length}/${table.rows.length} 行${truncated ? "（已截断）" : ""}`,
  );
  lines.push("");
  lines.push(colNames.join(" | "));

  for (const row of rows) {
    const cells = row.map((cell, i) =>
      formatCell(cell, table.types[i]?.dtype ?? "object"),
    );
    lines.push(cells.join(" | "));
  }

  if (table.rows.length === 0) {
    lines.push("（0 行）");
  } else if (truncated) {
    lines.push(
      `（结果已截断，共 ${table.rows.length} 行；请增加过滤条件或 LIMIT 后重试。）`,
    );
  }

  return {
    text: lines.join("\n"),
    details: {
      query,
      resultType: "table",
      columns: table.types,
      rows,
      totalRows: table.rows.length,
      returnedRows: rows.length,
      truncated,
      maxRows: rowLimit,
      textLength: 0,
    },
  };
}

function formatCell(cell: unknown, _dtype: string): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object" && !Array.isArray(cell)) {
    const obj = cell as Record<string, unknown>;
    // Amount / Position / Inventory
    if ("number" in obj && "currency" in obj) {
      return `${obj.number} ${obj.currency}`;
    }
    return JSON.stringify(obj);
  }
  if (Array.isArray(cell)) {
    return cell.map((item) => formatCell(item, "object")).join(", ");
  }
  return String(cell).replaceAll("\n", "\\n").replaceAll("|", "\\|");
}
