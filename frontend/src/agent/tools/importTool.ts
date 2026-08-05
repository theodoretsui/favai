/**
 * ``propose_transactions`` tool: the agent submits transaction proposals.
 *
 * Schema mirrors the original ``pi_ext/favai.ts``.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Transaction } from "@/api";
import { getLedgerData } from "@/agent/favaApi";
import { t } from "@/i18n";

const PostingSchema = Type.Object({
  account: Type.String({ description: "账户全名，如 Expenses:Food:Restaurant" }),
  amount: Type.Optional(
    Type.String({ description: "金额（字符串），正数；配平分录留空" }),
  ),
  currency: Type.Optional(
    Type.String({ description: "货币代码，如 CNY、USD" }),
  ),
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
    description: "至少两条分录，其中至多一条可以缺少金额（配平分录）",
  }),
  tags: Type.Optional(
    Type.Array(
      Type.String({
        description: "Beancount 标签，不含 # 前缀，如 food、reimbursable",
      }),
    ),
  ),
  links: Type.Optional(Type.Array(Type.String())),
});

const ProposeParams = Type.Object({
  transactions: Type.Array(TransactionSchema, {
    minItems: 1,
    description: "从账单中提取的交易列表",
  }),
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^-?\d+(\.\d+)?$/;
const TAG_RE = /^[A-Za-z0-9._/-]+$/;

interface DecimalValue {
  int: bigint;
  scale: number;
}

function parseDecimal(value: string): DecimalValue | null {
  const trimmed = value.trim();
  if (!AMOUNT_RE.test(trimmed)) {
    return null;
  }
  const negative = trimmed.startsWith("-");
  const digits = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = digits.split(".");
  const scale = fracPart.length;
  const int = BigInt(`${negative ? "-" : ""}${intPart}${fracPart}`);
  return { int, scale };
}

function formatDecimal({ int, scale }: DecimalValue): string {
  const negative = int < 0n;
  const abs = negative ? -int : int;
  const s = abs.toString().padStart(scale + 1, "0");
  const intStr = s.slice(0, -scale) || "0";
  const fracStr = s.slice(-scale);
  return `${negative ? "-" : ""}${intStr}${scale > 0 ? `.${fracStr}` : ""}`;
}

function validateTransaction(
  txn: Transaction,
  index: number,
  accountSet: Set<string>,
): string[] {
  const errors: string[] = [];
  const i = index + 1;

  if (!DATE_RE.test(txn.date)) {
    errors.push(t("import.validation.dateInvalid", { index: i, date: txn.date }));
  }

  for (const tag of txn.tags ?? []) {
    if (!TAG_RE.test(tag)) {
      errors.push(t("import.validation.tagInvalid", { index: i, tag }));
    }
  }

  const postings = txn.postings ?? [];
  if (postings.length < 2) {
    errors.push(t("import.validation.postingsTooFew", { index: i }));
  }

  let unspecified = 0;
  const byCurrency = new Map<string, DecimalValue[]>();

  for (const posting of postings) {
    const account = posting.account?.trim() ?? "";
    if (!account) {
      errors.push(t("import.validation.accountEmpty", { index: i }));
    } else if (!accountSet.has(account)) {
      errors.push(
        t("import.validation.accountInvalid", { index: i, account }),
      );
    }

    const amount = posting.amount?.trim() ?? "";
    if (!amount) {
      unspecified += 1;
      continue;
    }

    const parsed = parseDecimal(amount);
    if (!parsed) {
      errors.push(
        t("import.validation.amountFormatInvalid", { index: i, amount }),
      );
      continue;
    }

    const currency = (posting.currency?.trim() ?? "") || "__default__";
    const list = byCurrency.get(currency) ?? [];
    list.push(parsed);
    byCurrency.set(currency, list);
  }

  if (unspecified > 1) {
    errors.push(t("import.validation.multipleUnspecified", { index: i }));
  }

  if (unspecified === 0) {
    for (const [currency, values] of byCurrency) {
      const maxScale = Math.max(...values.map((v) => v.scale));
      let sum = 0n;
      for (const v of values) {
        if (v.scale === maxScale) {
          sum += v.int;
        } else {
          sum += v.int * (10n ** BigInt(maxScale - v.scale));
        }
      }
      if (sum !== 0n) {
        const currencyLabel =
          currency === "__default__"
            ? t("import.validation.currencyUnspecified")
            : currency;
        errors.push(
          t("import.validation.unbalanced", {
            index: i,
            currency: currencyLabel,
            difference: formatDecimal({ int: sum, scale: maxScale }),
          }),
        );
      }
    }
  }

  return errors;
}

/**
 * Create a ``propose_transactions`` tool.
 *
 * @param onProposal - Called when the agent submits a batch of transactions.
 */
export function makeImportTool(
  onProposal: (txns: Transaction[]) => void,
): AgentTool<typeof ProposeParams> {
  return {
    name: "propose_transactions",
    label: "提交交易提案",
    description:
      "提交从账单材料中提取的交易，每笔交易包含日期、摘要和至少两条会计录。",
    parameters: ProposeParams,
    execute: async (_toolCallId, params, _signal) => {
      const txns = (params.transactions as Transaction[]).map((txn) => ({
        ...txn,
        flag: txn.flag ?? "complete",
        tags: txn.tags?.map((tag) => tag.trim().replace(/^#/, "")),
      }));
      const { accounts } = getLedgerData();
      const accountSet = new Set(accounts);

      const errors: string[] = [];
      for (let i = 0; i < txns.length; i++) {
        errors.push(...validateTransaction(txns[i], i, accountSet));
      }
      if (errors.length > 0) {
        throw new Error(errors.join("\n"));
      }

      onProposal(txns);
      return {
        content: [
          {
            type: "text" as const,
            text: `已提交 ${txns.length} 笔交易提案，等待用户确认或反馈。`,
          },
        ],
        details: {},
      };
    },
  };
}
