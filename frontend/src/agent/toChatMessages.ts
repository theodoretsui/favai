/**
 * Convert pi-agent-core's ``AgentMessage[]`` transcript into the ``Message[]``
 * shape expected by the Chat UI component.
 *
 * The Chat UI renders tool calls/results natively via ``parts``, so the agent
 * transcript is the single source of truth -- no manual streaming delta
 * assembly or "indicator" messages are needed.
 */
import type { Message as PiAiMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ChatMessage, ToolInvocation } from "@/agent/chatTypes";

interface ToolResultLookup {
  result: unknown;
  isError: boolean;
}

const INGEST_BLOCK_PREFIX = "<favai-ingest>\n";

/** Mark extracted file/OCR text as a distinct user-message content block. */
export function ingestContentBlock(text: string): { type: "text"; text: string } {
  return { type: "text", text: `${INGEST_BLOCK_PREFIX}${text}` };
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
): ChatMessage[] {
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

  const out: ChatMessage[] = [];
  for (const msg of committed) {
    // Tool results are protocol messages, not standalone chat messages. Their
    // content is already attached to the matching assistant tool call above.
    if (msg.role === "toolResult") continue;
    appendChatMessage(out, toChatMessage(msg, resultsById));
  }
  if (streaming) {
    appendChatMessage(out, toChatMessage(streaming, resultsById));
  }

  return out;
}

/** Keep every assistant step after one user message in a single UI bubble. */
function appendChatMessage(out: ChatMessage[], message: ChatMessage): void {
  const previous = out.at(-1);
  if (previous?.role !== "assistant" || message.role !== "assistant") {
    out.push(message);
    return;
  }

  out[out.length - 1] = {
    ...previous,
    content: previous.content + message.content,
    parts: mergeOptional(previous.parts, message.parts),
    toolInvocations: mergeOptional(
      previous.toolInvocations,
      message.toolInvocations,
    ),
  };
}

function mergeOptional<T>(left?: T[], right?: T[]): T[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  return merged.length > 0 ? merged : undefined;
}

function toChatMessage(
  msg: PiAiMessage,
  resultsById: Map<string, ToolResultLookup>,
): ChatMessage {
  if (msg.role === "user") {
    const ingestTexts: string[] = [];
    const attachments: NonNullable<ChatMessage["experimental_attachments"]> = [];
    let visibleText = "";
    if (typeof msg.content === "string") {
      visibleText = msg.content;
    } else {
      for (const block of msg.content) {
        if (block.type === "text") {
          if (block.text.startsWith(INGEST_BLOCK_PREFIX)) {
            ingestTexts.push(block.text.slice(INGEST_BLOCK_PREFIX.length));
          } else {
            visibleText += block.text;
          }
        } else {
          // Older pure-image prompts were persisted without the `type` field.
          // Accept that shape so existing sessions also regain thumbnails.
          const imageBlock = block as {
            type?: string;
            data?: string;
            mimeType?: string;
          };
          if (!imageBlock.data || !imageBlock.mimeType) continue;
          const imageNumber = attachments.length + 1;
          attachments.push({
            name: `image-${imageNumber}`,
            contentType: imageBlock.mimeType,
            url: `data:${imageBlock.mimeType};base64,${imageBlock.data}`,
          });
        }
      }
    }
    return {
      id: `u-${msg.timestamp}`,
      role: "user",
      content: visibleText,
      createdAt: new Date(msg.timestamp),
      ingestTexts: ingestTexts.length > 0 ? ingestTexts : undefined,
      experimental_attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  // Assistant (also covers streamingMessage, which is an AssistantMessage).
  const parts: ChatMessage["parts"] = [];
  const toolInvocations: NonNullable<ChatMessage["toolInvocations"]> = [];
  let textAccumulator = "";

  for (const block of msg.content) {
    if (block.type === "text") {
      textAccumulator += block.text;
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "thinking") {
      parts.push({ type: "reasoning", reasoning: block.thinking });
    } else if (block.type === "toolCall") {
      const matched = resultsById.get(block.id);
      const invocation: ToolInvocation = matched
        ? {
          state: "result",
          toolName: block.name,
          result: matched.isError
            ? { __error: true, ...asObject(matched.result) }
            : asObject(matched.result),
        }
        : {
          state: "call",
          toolName: block.name,
        };
      toolInvocations.push(invocation);
      parts.push({ type: "tool-invocation", toolInvocation: invocation });
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
