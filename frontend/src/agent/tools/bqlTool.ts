/**
 * ``bql_query`` tool: run a Beancount Query Language query against the ledger.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { runQuery, flattenTable } from "@/agent/favaApi";

const BqlParams = Type.Object({
  query: Type.String({
    description:
      "BQL 查询语句，例如「SELECT account, sum(position) WHERE account ~ 'Expenses:Food'」",
  }),
});

/**
 * Create a ``bql_query`` tool.
 */
export function makeBqlTool(): AgentTool<typeof BqlParams> {
  return {
    name: "bql_query",
    label: "查询账本",
    description: "运行 BQL 查询获取账本数据，返回表格结果。",
    parameters: BqlParams,
    execute: async (_toolCallId, params, _signal) => {
      const result = await runQuery(params.query);
      const text = flattenTable(result, 200);
      return {
        content: [{ type: "text" as const, text }],
        details: {},
      };
    },
  };
}
