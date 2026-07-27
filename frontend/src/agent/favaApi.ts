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
export async function runQuery(bql: string): Promise<QueryResult> {
  const { baseUrl } = getLedgerData();
  const url = `${baseUrl}api/query?query_string=${encodeURIComponent(bql)}`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data as QueryResult;
}

/**
 * Flatten a ``QueryResultTable`` into a plain string for the LLM.
 *
 * Amount cells (``{number, currency}``) are converted to ``"123.45 CNY"``.
 * Rows exceeding ``maxRows`` are truncated with a note.
 */
export function flattenTable(result: QueryResult, maxRows = 200): string {
  if (result.t === "string") {
    return result.contents;
  }

  const table = result;
  const lines: string[] = [];
  const colNames = table.types.map((t) => t.name);
  lines.push(colNames.join(" | "));

  const data = table.rows.slice(0, maxRows);
  for (const row of data) {
    const cells = row.map((cell, i) => formatCell(cell, table.types[i]?.dtype ?? "object"));
    lines.push(cells.join(" | "));
  }

  if (table.rows.length > maxRows) {
    lines.push(`(已截断，共 ${table.rows.length} 行)`);
  }

  return lines.join("\n");
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
    return cell.join(", ");
  }
  return String(cell);
}
