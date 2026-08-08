/**
 * ``create_ledger_file`` tool: proposes creating a Beancount source file and
 * including it from the main ledger.
 *
 * This is a gated write tool: the ``beforeToolCall`` hook waits for explicit
 * user approval and mints a single-use backend capability; ``execute`` takes
 * that capability and submits the exact reviewed operation to the backend,
 * which independently revalidates everything before mutating.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ApprovalManager } from "@/agent/approval";
import { api } from "@/api";
import { t } from "@/i18n";

const CreateLedgerFileParams = Type.Object({
  path: Type.String({
    description:
      "主账本目录下的相对路径，如 sub/2026.beancount；仅允许 .beancount 文件",
  }),
  initial_content: Type.String({
    description: "新文件的初始 Beancount 内容（空字符串也可）",
  }),
  include_in_main: Type.Boolean({
    description: "是否在主账本文件末尾添加 include 语句（必须为 true）",
  }),
});

/**
 * Create the gated ``create_ledger_file`` tool.
 *
 * @param manager - Approval manager holding the single-use capability minted
 *                  after the user approved this exact operation.
 */
export function makeCreateLedgerFileTool(manager?: ApprovalManager): AgentTool<
  typeof CreateLedgerFileParams
> {
  return {
    name: "create_ledger_file",
    label: "创建账本文件",
    description:
      "在账本目录下新建一个 .beancount 源文件，并在主账本文件末尾添加 include。该操作为写入操作，必须经用户批准后才会执行；不会覆盖已存在的文件。",
    parameters: CreateLedgerFileParams,
    execute: async (_toolCallId, params, _signal) => {
      if (!manager) {
        throw new Error(t("create_file.error.no_approval"));
      }
      const grant = await manager.takeCapability("create_ledger_file", params);
      if (!grant) {
        throw new Error(t("create_file.error.no_approval"));
      }
      let result: {
        created_path: string;
        include_path: string;
        already_completed: boolean;
      };
      try {
        result = await api.createLedgerFile({
          capability: grant.capability,
          operation: params,
        });
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
      const text = result.already_completed
        ? t("create_file.done.already", {
            path: result.created_path,
            include: result.include_path,
          })
        : t("create_file.done.created", {
            path: result.created_path,
            include: result.include_path,
          });
      return {
        content: [{ type: "text" as const, text }],
        details: { result },
      };
    },
  };
}
