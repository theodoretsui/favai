/**
 * Agent factory: creates pi-agent-core ``Agent`` instances pre-configured
 * for import or chat use-cases.
 */

import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Config, ChangeSetPreview } from "@/api";
import { buildModels } from "@/agent/provider";
import { makeProposeTransactionsTool } from "@/agent/tools/proposeTransactionsTool";
import { makeProposeDirectivesTool } from "@/agent/tools/proposeDirectivesTool";
import { makeBqlTool } from "@/agent/tools/bqlTool";
import { makeBqlHelpTool } from "@/agent/tools/bqlHelpTool";
import {
  CHAT_SYSTEM_PROMPT,
  UNIFIED_SYSTEM_PROMPT,
  withBookkeepingHabits,
} from "@/agent/prompts";
import { makeTodayTool } from "@/agent/tools/dateTool";

/**
 * Create a pi agent for an import session.
 *
 * @param config         - LLM provider configuration.
 * @param onProposal     - Called when the agent submits a change set.
 * @param getSessionId   - Current conversation session id.
 * @returns              - An ``Agent`` ready to ``prompt()``.
 */
export function createImportAgent(
  config: Config,
  onProposal: (changeSet: ChangeSetPreview) => void,
  getSessionId: () => string | undefined,
) {
  const { models, model } = buildModels(config);
  const streamFn: StreamFn = (m, ctx, opts) => models.streamSimple(m, ctx, opts);

  return new Agent({
    initialState: {
      systemPrompt: "", // The bill-materials prompt is sent as the first user message.
      model,
      tools: [
        makeProposeTransactionsTool(onProposal, getSessionId),
        makeProposeDirectivesTool(onProposal, getSessionId),
      ],
    },
    streamFn,
  });
}

/**
 * Create a pi agent for the analysis chat.
 *
 * @param config - LLM provider configuration.
 * @param bookkeepingHabits - Ledger-wide user preferences.
 * @returns      - An ``Agent`` ready to ``prompt()``.
 */
export function createChatAgent(config: Config, bookkeepingHabits = "") {
  const { models, model } = buildModels(config);
  const streamFn: StreamFn = (m, ctx, opts) => models.streamSimple(m, ctx, opts);

  return new Agent({
    initialState: {
      systemPrompt: withBookkeepingHabits(
        CHAT_SYSTEM_PROMPT,
        bookkeepingHabits,
      ),
      model,
      tools: [makeBqlHelpTool(), makeBqlTool()],
    },
    streamFn,
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
 * @param onProposal - Called when the agent submits ``propose_transactions``.
 * @returns          - An ``Agent`` ready to ``prompt()``.
 */
export function createUnifiedAgent(
  config: Config,
  bookkeepingHabits: string,
  onProposal: (changeSet: ChangeSetPreview) => void,
  getSessionId: () => string | undefined,
) {
  const { models, model } = buildModels(config);
  const streamFn: StreamFn = (m, ctx, opts) => models.streamSimple(m, ctx, opts);

  return new Agent({
    initialState: {
      systemPrompt: withBookkeepingHabits(
        UNIFIED_SYSTEM_PROMPT,
        bookkeepingHabits,
      ),
      model,
      tools: [
        makeProposeTransactionsTool(onProposal, getSessionId),
        makeProposeDirectivesTool(onProposal, getSessionId),
        makeBqlHelpTool(),
        makeBqlTool(),
        makeTodayTool(),
      ],
    },
    streamFn,
  });
}
