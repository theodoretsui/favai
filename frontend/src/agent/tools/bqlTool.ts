/**
 * ``bql_query`` tool: run a Beancount Query Language query against the ledger.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { formatQueryResult, runQuery } from "@/agent/favaApi";

const BqlParams = Type.Object({
  query: Type.String({
    description:
      "要执行的只读 BQL。普通账本查询不需要 SQL 表名；FROM 过滤完整 entry/transaction，WHERE 过滤 posting。例如：SELECT account, units(sum(position)) WHERE account ~ '^Expenses:' GROUP BY account",
  }),
});

const READ_ONLY_COMMANDS = new Set([
  "SELECT",
  "BALANCES",
  "JOURNAL",
  "PRINT",
  "RUN",
  "EXPLAIN",
]);

function hasEmbeddedStatementSeparator(query: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (quote) {
      if (char === quote) {
        if (query[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ";" && query.slice(index + 1).trim()) {
      return true;
    }
  }
  return false;
}

/** Reject commands that are not part of favai's read-only BQL surface. */
export function assertReadOnlyBql(query: string): void {
  if (hasEmbeddedStatementSeparator(query)) {
    throw new Error("每次只能执行一条只读 BQL 查询。");
  }
  const command = query.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase();
  if (!command || !READ_ONLY_COMMANDS.has(command)) {
    throw new Error(
      "仅允许 SELECT、BALANCES、JOURNAL、PRINT、RUN 或 EXPLAIN 只读查询。",
    );
  }
  if (
    command === "EXPLAIN" &&
    !/^EXPLAIN\s+(SELECT|BALANCES|JOURNAL|PRINT)\b/i.test(query)
  ) {
    throw new Error("EXPLAIN 只能用于 SELECT、BALANCES、JOURNAL 或 PRINT 查询。");
  }
}

/**
 * Create a ``bql_query`` tool.
 */
export function makeBqlTool(): AgentTool<typeof BqlParams> {
  return {
    name: "bql_query",
    label: "查询账本",
    description:
      "运行一条只读 BQL 并返回结构化账本结果。语法或 position/inventory 口径不确定时先调用 bql_help；失败后根据错误修正并重试，不要把失败解释成没有数据。",
    parameters: BqlParams,
    execute: async (_toolCallId, params, signal) => {
      const query = params.query.trim();
      if (!query) {
        throw new Error("BQL 查询不能为空。请提供 SELECT、BALANCES、JOURNAL 或 PRINT 查询。");
      }
      assertReadOnlyBql(query);
      try {
        const result = await runQuery(query, signal);
        const formatted = formatQueryResult(query, result, 200);
        return {
          content: [{ type: "text" as const, text: formatted.text }],
          details: formatted.details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `BQL 查询失败：${message}\n请调用 bql_help(topic="troubleshooting")，根据错误修正查询后重试。`,
        );
      }
    },
  };
}
