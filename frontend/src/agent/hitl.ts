/**
 * ``beforeToolCall`` gate wiring pi-agent-core to the approval manager.
 *
 * pi-agent-core runs this hook after tool arguments have been validated and
 * before ``execute`` is entered. Returning ``{ block: true, reason }`` makes
 * the loop emit an error tool result (which the agent can understand) instead
 * of executing. Read and propose tools return ``undefined`` immediately and
 * never produce an approval prompt.
 */

import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type { ApprovalManager } from "@/agent/approval";
import {
  DEFAULT_TOOL_RISK,
  requiresApproval,
  resolveToolRisk,
  type ToolRiskRegistry,
} from "@/agent/risk";

export interface ApprovalGateContext {
  /** Identity of the current ledger page the approval is bound to. */
  getLedgerId: () => string;
  /** Current conversation session id (undefined before the first message). */
  getSessionId: () => string | undefined;
}

export type BeforeToolCallHook = (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>;

/**
 * Build the ``beforeToolCall`` hook for an ``Agent``.
 *
 * For gated (write/destructive) tools the hook creates an approval request
 * and waits for the explicit UI decision; anything but approval blocks the
 * call with a reason the agent can read from the error tool result.
 */
export function makeBeforeToolCallGate(
  manager: ApprovalManager,
  context: ApprovalGateContext,
  registry: ToolRiskRegistry = DEFAULT_TOOL_RISK,
): BeforeToolCallHook {
  return async (call, signal) => {
    const risk = resolveToolRisk(call.toolCall.name, registry);
    if (!requiresApproval(risk.policy)) {
      return undefined; // read/propose: never prompt
    }
    const decision = await manager.requestApproval(
      {
        toolName: call.toolCall.name,
        policy: risk.policy as "write" | "destructive",
        args: call.args,
        ledgerId: context.getLedgerId(),
        sessionId: context.getSessionId(),
        effectKey: risk.effectKey,
      },
      signal,
    );
    if (decision.outcome === "approved") {
      return undefined;
    }
    return {
      block: true,
      reason: decision.reason ?? "操作未获授权，本次调用未执行。",
    };
  };
}
