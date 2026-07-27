/**
 * Convert pi-agent-core's ``AgentMessage[]`` transcript into the ``Message[]``
 * shape expected by the Chat UI component.
 *
 * The Chat UI renders tool calls/results natively via ``parts``, so the agent
 * transcript is the single source of truth -- no manual streaming delta
 * assembly or "indicator" messages are needed.
 */
import { contentText, type Message as PiAiMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@/components/ui/chat";

interface ToolResultLookup {
  result: unknown;
  isError: boolean;
}

/**
 * Build the Chat UI message list from agent state.
 *
 * @param messages       - ``agent.state.messages`` (committed transcript).
 * @param streamingMessage - ``agent.state.streamingMessage`` (partial assistant
 *                           message during streaming, undefined when idle).
 */
export function toChatMessages(
  messages: readonly AgentMessage[],
  streamingMessage?: AgentMessage,
): Message[] {
  // ``AgentMessage`` is structurally pi-ai ``Message`` (see note above).
  const committed = messages as readonly PiAiMessage[];
  const streaming = streamingMessage as PiAiMessage | undefined;

  // Index tool results by toolCallId so assistant toolCall parts can be paired
  // with their results and rendered as ``state: "result"``.
  const resultsById = new Map<string, ToolResultLookup>();
  for (const msg of committed) {
    if (msg.role === "toolResult") {
      resultsById.set(msg.toolCallId, {
        result: extractToolResultText(msg.content),
        isError: msg.isError,
      });
    }
  }

  const out: Message[] = [];
  for (const msg of committed) {
    out.push(toChatMessage(msg, resultsById));
  }
  if (streaming) {
    out.push(toChatMessage(streaming, resultsById));
  }
  return out;
}

function toChatMessage(
  msg: PiAiMessage,
  resultsById: Map<string, ToolResultLookup>,
): Message {
  if (msg.role === "user") {
    return {
      id: `u-${msg.timestamp}`,
      role: "user",
      content: contentText(msg.content),
      createdAt: new Date(msg.timestamp),
    };
  }

  // Assistant (also covers streamingMessage, which is an AssistantMessage).
  const parts: Message["parts"] = [];
  const toolInvocations: NonNullable<Message["toolInvocations"]> = [];
  let textAccumulator = "";

  for (const block of msg.content) {
    if (block.type === "text") {
      textAccumulator += block.text;
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "thinking") {
      parts.push({ type: "reasoning", reasoning: block.thinking });
    } else if (block.type === "toolCall") {
      const matched = resultsById.get(block.id);
      if (matched) {
        toolInvocations.push({
          state: "result",
          toolName: block.name,
          result: matched.isError
            ? { __error: true, ...asObject(matched.result) }
            : asObject(matched.result),
        });
      } else {
        toolInvocations.push({
          state: "call",
          toolName: block.name,
        });
      }
    }
  }

  return {
    id: `a-${msg.timestamp}`,
    role: "assistant",
    content: textAccumulator,
    createdAt: new Date(msg.timestamp),
    parts: parts.length > 0 ? parts : undefined,
    toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
  };
}

/** Extract the textual content returned by a tool for display. */
function extractToolResultText(
  content: readonly { type: string; text?: string }[],
): unknown {
  const texts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  if (texts.length === 0) return "";
  if (texts.length === 1) return texts[0];
  return texts.join("\n");
}

/** Coerce a tool result value into a plain object for the Chat UI. */
function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return { value };
}
