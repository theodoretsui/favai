/**
 * ``propose_transactions`` v2 tool: the agent submits a complete batch of
 * typed transactions into the pending change set.
 *
 * One call contains every transaction currently being proposed; a retry
 * replaces the prior agent-generated batch instead of appending duplicates.
 * Success means "accepted for review" — the ledger is never written here.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ChangeSetPreview, Transaction } from "@/api";
import { api } from "@/api";
import { t } from "@/i18n";

const MetadataSchema = Type.Record(
  Type.String(),
  Type.Union([
    Type.String(),
    Type.Number(),
    Type.Boolean(),
  ]),
);

const UnitsSchema = Type.Object({
  number: Type.String({
    description: "数量（有符号数字字符串，如 -10 或 268.00）",
  }),
  currency: Type.String({ description: "币种/证券代码，如 CNY、GOOG" }),
});

const CostSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("per_unit", { description: "单位成本" }),
    number: Type.String({ description: "单位成本（非负数）" }),
    currency: Type.String(),
    date: Type.Optional(
      Type.String({ description: "成本起息日/购入日期，YYYY-MM-DD" }),
    ),
  }),
  Type.Object({
    kind: Type.Literal("total", { description: "总成本" }),
    number: Type.String({ description: "总成本（非负数）" }),
    currency: Type.String(),
    date: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal("compound", { description: "复合成本（每股价 # 每股费）" }),
    per_number: Type.String({ description: "每股价格（非负数）" }),
    total_number: Type.String({ description: "每股费用（非负数）" }),
    currency: Type.String(),
    date: Type.Optional(Type.String()),
  }),
]);

const PriceSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("per_unit", { description: "单价" }),
    number: Type.String({ description: "单价（非负数）" }),
    currency: Type.String(),
  }),
  Type.Object({
    kind: Type.Literal("total", { description: "总价" }),
    number: Type.String({ description: "总价（非负数）" }),
    currency: Type.String(),
  }),
]);

const PostingSchema = Type.Object({
  account: Type.String({ description: "账户全名，如 Expenses:Food:Restaurant" }),
  flag: Type.Optional(
    Type.String({
      description:
        "分录 flag（单个字母，如 P 表示配平估算），普通分录省略",
    }),
  ),
  units: Type.Optional(
    UnitsSchema,
  ),
  cost: Type.Optional(CostSchema),
  price: Type.Optional(PriceSchema),
  metadata: Type.Optional(MetadataSchema),
});

const TransactionSchema = Type.Object({
  date: Type.String({ description: "日期，YYYY-MM-DD" }),
  flag: Type.Union([Type.Literal("complete"), Type.Literal("incomplete")], {
    description:
      "交易状态：信息可信且无需复核时为 complete；存在不确定信息、需要用户确认或修改时为 incomplete",
  }),
  payee: Type.Optional(Type.String({ description: "收款方/交易对手" })),
  narration: Type.String({ description: "交易摘要" }),
  postings: Type.Array(PostingSchema, {
    minItems: 2,
    description:
      "至少两条分录；至多一条可以省略 units（Beancount 插值配平）",
  }),
  tags: Type.Optional(
    Type.Array(
      Type.String({
        description: "Beancount 标签，不含 # 前缀，如 food、reimbursable",
      }),
    ),
  ),
  links: Type.Optional(Type.Array(Type.String())),
  metadata: Type.Optional(MetadataSchema),
});

const ProposeParams = Type.Object({
  transactions: Type.Array(TransactionSchema, {
    minItems: 1,
    description:
      "本批次包含当前提案的全部交易；重试会整体替换上一批交易，切勿重复提交已提交的交易",
  }),
});

/**
 * Create the ``propose_transactions`` v2 tool.
 *
 * @param onProposal   - Called with the validated change-set preview.
 * @param getSessionId - Current conversation session id.
 */
export function makeProposeTransactionsTool(
  onProposal: (changeSet: ChangeSetPreview) => void,
  getSessionId: () => string | undefined,
): AgentTool<typeof ProposeParams> {
  return {
    name: "propose_transactions",
    label: "提交交易提案",
    description:
      "提交从账单材料中提取的全部交易（含成本、价格、起息日等类型化字段）。一次调用提交完整批次；重试替换上一批交易。成功仅表示提案已接受审查，不会写入账本。",
    parameters: ProposeParams,
    execute: async (_toolCallId, params, _signal) => {
      const txns = (params.transactions as Transaction[]).map((txn) => ({
        ...txn,
        flag: txn.flag ?? "complete",
        tags: txn.tags?.map((tag) => tag.trim().replace(/^#/, "")),
      }));
      let changeSet: ChangeSetPreview;
      try {
        changeSet = await api.proposalPreview(
          "transactions",
          { transactions: txns },
          getSessionId(),
        );
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : String(err),
        );
      }
      onProposal(changeSet);
      const lines = [
        t("propose.transactions.done", {
          count: changeSet.transaction_count,
        }),
        t("propose.preview.revision", { revision: changeSet.revision }),
        "",
        changeSet.preview,
      ];
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { changeSet },
      };
    },
  };
}
