/**
 * Agent factory: creates pi-agent-core ``Agent`` instances pre-configured
 * for import or chat use-cases.
 */

import { Agent, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Config, ChangeSetPreview } from "@/api";
import type { ApprovalManager } from "@/agent/approval";
import {
  makeBeforeToolCallGate,
  type ApprovalGateContext,
  type BeforeToolCallHook,
} from "@/agent/hitl";
import { requiresApproval, resolveToolRisk } from "@/agent/risk";
import { buildModels } from "@/agent/provider";
import { makeProposeTransactionsTool } from "@/agent/tools/proposeTransactionsTool";
import { makeProposeDirectivesTool } from "@/agent/tools/proposeDirectivesTool";
import { makeBqlTool } from "@/agent/tools/bqlTool";
import { makeBqlHelpTool } from "@/agent/tools/bqlHelpTool";
import { makeCreateLedgerFileTool } from "@/agent/tools/createLedgerFileTool";
import {
  CHAT_SYSTEM_PROMPT,
  UNIFIED_SYSTEM_PROMPT,
  withBookkeepingHabits,
} from "@/agent/prompts";
import { makeTodayTool } from "@/agent/tools/dateTool";

/** Optional human-in-the-loop wiring for gated (write) tools. */
export interface ApprovalWiring extends ApprovalGateContext {
  manager: ApprovalManager;
}

/**
 * Attach the approval gate to a tool list.
 *
 * Gated tools are forced to ``executionMode: "sequential"`` so multiple
 * proposed mutations can never race through approval or execution, and the
 * ``beforeToolCall`` hook blocks any gated call until the user approves it.
 */
function withApprovalGate(
  tools: AgentTool<any>[],
  approval?: ApprovalWiring,
): { tools: AgentTool<any>[]; beforeToolCall?: BeforeToolCallHook } {
  return {
    tools: tools.map((tool) =>
      requiresApproval(resolveToolRisk(tool.name).policy)
        ? { ...tool, executionMode: "sequential" as const }
        : tool,
    ),
    beforeToolCall: approval
      ? makeBeforeToolCallGate(approval.manager, approval)
      : undefined,
  };
}

/**
 * Create a pi agent for an import session.
 *
 * @param config         - LLM provider configuration.
 * @param onProposal     - Called when the agent submits a change set.
 * @param getSessionId   - Current conversation session id.
 * @param approval       - Optional HITL wiring for gated tools.
 * @returns              - An ``Agent`` ready to ``prompt()``.
 */
export function createImportAgent(
  config: Config,
  onProposal: (changeSet: ChangeSetPreview) => void,
  getSessionId: () => string | undefined,
  approval?: ApprovalWiring,
) {
  const { models, model } = buildModels(config);
  const streamFn: StreamFn = (m, ctx, opts) => models.streamSimple(m, ctx, opts);
  const gated = withApprovalGate(
    [
      makeProposeTransactionsTool(onProposal, getSessionId),
      makeProposeDirectivesTool(onProposal, getSessionId),
    ],
    approval,
  );

  return new Agent({
    initialState: {
      systemPrompt: "", // The bill-materials prompt is sent as the first user message.
      model,
      tools: gated.tools,
    },
    streamFn,
    beforeToolCall: gated.beforeToolCall,
  });
}

/**
 * Create a pi agent for the analysis chat.
 *
 * @param config - LLM provider configuration.
 * @param bookkeepingHabits - Ledger-wide user preferences.
 * @param approval - Optional HITL wiring for gated tools.
 * @returns      - An ``Agent`` ready to ``prompt()``.
 */
export function createChatAgent(
  config: Config,
  bookkeepingHabits = "",
  approval?: ApprovalWiring,
) {
  const { models, model } = buildModels(config);
  const streamFn: StreamFn = (m, ctx, opts) => models.streamSimple(m, ctx, opts);
  const gated = withApprovalGate([makeBqlHelpTool(), makeBqlTool()], approval);

  return new Agent({
    initialState: {
      systemPrompt: withBookkeepingHabits(
        CHAT_SYSTEM_PROMPT,
        bookkeepingHabits,
      ),
      model,
      tools: gated.tools,
    },
    streamFn,
    beforeToolCall: gated.beforeToolCall,
  });
}

/**
 * Create a unified pi agent with both import and chat capabilities.
 *
 * The agent includes both ``propose_transactions`` and ``bql_query`` tools,
 * and uses a combined system prompt. The caller decides whether to send an
 * import-style prompt (with ledger data + ingest results) or a plain chat
 * message based on whether files were attached.
 *
 * @param config     - LLM provider configuration.
 * @param bookkeepingHabits - Ledger-wide user preferences.
 * @param onProposal - Called when the agent submits a change set.
 * @param getSessionId - Current conversation session id.
 * @param approval   - Optional HITL wiring for gated tools.
 * @returns          - An ``Agent`` ready to ``prompt()``.
 */
export function createUnifiedAgent(
  config: Config,
  bookkeepingHabits: string,
  onProposal: (changeSet: ChangeSetPreview) => void,
  getSessionId: () => string | undefined,
  approval?: ApprovalWiring,
) {
  const { models, model } = buildModels(config);
  const streamFn: StreamFn = (m, ctx, opts) => models.streamSimple(m, ctx, opts);
  const gated = withApprovalGate(
    [
      makeProposeTransactionsTool(onProposal, getSessionId),
      makeProposeDirectivesTool(onProposal, getSessionId),
      makeCreateLedgerFileTool(approval?.manager, getSessionId),
      makeBqlHelpTool(),
      makeBqlTool(),
      makeTodayTool(),
    ],
    approval,
  );

  return new Agent({
    initialState: {
      systemPrompt: withBookkeepingHabits(
        UNIFIED_SYSTEM_PROMPT,
        bookkeepingHabits,
      ),
      model,
      tools: gated.tools,
    },
    streamFn,
    beforeToolCall: gated.beforeToolCall,
  });
}
