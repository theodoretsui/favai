/**
 * ``propose_directives`` tool: the agent submits a complete batch of typed
 * non-transaction directives into the pending change set.
 *
 * Only the initial allowlist (open, commodity, price, balance, note, event)
 * is accepted; the backend rejects everything else before write.  Retries
 * replace the prior directive batch instead of appending.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ChangeSetPreview, Directive } from "@/api";
import { api } from "@/api";
import { t } from "@/i18n";

const MetadataSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
);

const AmountSchema = Type.Object({
  number: Type.String({ description: "金额（有符号数字字符串）" }),
  currency: Type.String(),
});

const DirectiveSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("open"),
    date: Type.String({ description: "日期，YYYY-MM-DD" }),
    account: Type.String({ description: "账户全名" }),
    currencies: Type.Optional(
      Type.Array(Type.String({ description: "允许的币种" })),
    ),
    booking: Type.Optional(
      Type.String({
        description: "记账方式：NONE/STRICT/AVERAGE/FIFO/LIFO/HIFO",
      }),
    ),
    metadata: Type.Optional(MetadataSchema),
  }),
  Type.Object({
    kind: Type.Literal("commodity"),
    date: Type.String(),
    currency: Type.String({ description: "币种/证券代码" }),
    metadata: Type.Optional(MetadataSchema),
  }),
  Type.Object({
    kind: Type.Literal("price"),
    date: Type.String(),
    commodity: Type.String({ description: "币种/证券代码" }),
    amount: AmountSchema,
    metadata: Type.Optional(MetadataSchema),
  }),
  Type.Object({
    kind: Type.Literal("balance"),
    date: Type.String(),
    account: Type.String(),
    amount: AmountSchema,
    metadata: Type.Optional(MetadataSchema),
  }),
  Type.Object({
    kind: Type.Literal("note"),
    date: Type.String(),
    account: Type.String(),
    comment: Type.String({ description: "注解内容" }),
    metadata: Type.Optional(MetadataSchema),
  }),
  Type.Object({
    kind: Type.Literal("event"),
    date: Type.String(),
    type: Type.String({ description: "事件类型，如 location" }),
    description: Type.String({ description: "事件描述" }),
    metadata: Type.Optional(MetadataSchema),
  }),
]);

const ProposeParams = Type.Object({
  directives: Type.Array(DirectiveSchema, {
    minItems: 1,
    description:
      "本批次包含当前提案的全部指令；重试会整体替换上一批指令，切勿重复提交已提交的指令",
  }),
});

/**
 * Create the ``propose_directives`` tool.
 *
 * @param onProposal   - Called with the validated change-set preview.
 * @param getSessionId - Current conversation session id.
 */
export function makeProposeDirectivesTool(
  onProposal: (changeSet: ChangeSetPreview) => void,
  getSessionId: () => string | undefined,
): AgentTool<typeof ProposeParams> {
  return {
    name: "propose_directives",
    label: "提交指令提案",
    description:
      "提交非交易类的有日期指令（open、commodity、price、balance、note、event）。新账户必须先用本工具提交 open，再在交易中引用。一次调用提交完整批次；重试替换上一批指令。成功仅表示提案已接受审查，不会写入账本。",
    parameters: ProposeParams,
    execute: async (_toolCallId, params, _signal) => {
      let changeSet: ChangeSetPreview;
      try {
        changeSet = await api.proposalPreview(
          "directives",
          { directives: params.directives as Directive[] },
          getSessionId(),
        );
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : String(err),
        );
      }
      onProposal(changeSet);
      const lines = [
        t("propose.directives.done", {
          count: changeSet.directive_count,
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
