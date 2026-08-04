export interface ChatAttachment {
  name?: string;
  contentType?: string;
  url: string;
}

export type ToolInvocation =
  | { state: "partial-call" | "call"; toolName: string }
  | {
      state: "result";
      toolName: string;
      result: { __cancelled?: boolean; __error?: boolean; [key: string]: unknown };
    };

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; reasoning: string }
  | { type: "tool-invocation"; toolInvocation: ToolInvocation }
  | { type: "source"; source?: unknown }
  | { type: "file"; mimeType: string; data: string }
  | { type: "step-start" };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | (string & {});
  content: string;
  createdAt?: Date;
  experimental_attachments?: ChatAttachment[];
  toolInvocations?: ToolInvocation[];
  parts?: MessagePart[];
  ingestTexts?: string[];
}
