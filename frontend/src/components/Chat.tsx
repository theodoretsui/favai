import { useEffect, useMemo, useRef, useState } from "react";
import {
  StopOutlined,
  CodeOutlined,
  CopyOutlined,
  PaperClipOutlined,
  RobotOutlined,
  ToolOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Attachments, Bubble, Sender, ThoughtChain } from "@ant-design/x";
import type { BubbleItemType } from "@ant-design/x";
import type { AttachmentsRef } from "@ant-design/x/es/attachments";
import type { SenderRef } from "@ant-design/x/es/sender";
import { Button, Collapse, Flex, Spin, Tooltip, Typography, Upload } from "antd";
import type { UploadFile } from "antd";

import type { ChatMessage, ToolInvocation } from "@/agent/chatTypes";
import type { ApprovalRequest } from "@/agent/approval";
import { t } from "@/i18n";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ApprovalPrompt } from "@/components/ApprovalPrompt";

const ACCEPTED_FILES = ".txt,.md,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.pdf";

interface ChatProps {
  messages: ChatMessage[];
  input: string;
  handleInputChange: (value: string) => void;
  handleSubmit: () => void;
  isGenerating: boolean;
  isProcessing?: boolean;
  stop?: () => void;
  className?: string;
  files?: File[] | null;
  setFiles?: React.Dispatch<React.SetStateAction<File[] | null>>;
  allowAttachments?: boolean;
  placeholder?: string;
  /** Pending human-in-the-loop approval, embedded in the composer header. */
  approval?: ApprovalRequest | null;
  onApprove?: () => void;
  onDeny?: () => void;
}

function ToolSteps({ invocations }: { invocations: ToolInvocation[] }) {
  return (
    <ThoughtChain
      line="solid"
      items={invocations.map((invocation, index) => {
        const result = invocation.state === "result" ? invocation.result : null;
        const cancelled = result?.__cancelled === true;
        const failed = result?.__error === true;
        return {
          key: `${invocation.toolName}-${index}`,
          title: cancelled
            ? `${t("chat.tool.cancelled")} ${invocation.toolName}`
            : invocation.state === "result"
              ? `${t("chat.tool.result")} ${invocation.toolName}`
              : `${t("chat.tool.calling")} ${invocation.toolName}`,
          icon: cancelled ? <StopOutlined /> : result ? <CodeOutlined /> : <ToolOutlined />,
          status: cancelled || failed ? "error" : result ? "success" : "loading",
          blink: !result,
          collapsible: Boolean(result),
          content: result ? (
            <pre className="max-w-full overflow-x-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : undefined,
        };
      })}
    />
  );
}

function MessageContent({ message }: { message: ChatMessage }) {
  const orderedParts = message.parts ?? [];
  const hasTextPart = orderedParts.some((part) => part.type === "text");
  const hasToolPart = orderedParts.some((part) => part.type === "tool-invocation");

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {message.experimental_attachments && (
        <Attachments
          disabled
          items={message.experimental_attachments.map((attachment, index) => ({
            uid: `${message.id}-${index}`,
            name: attachment.name ?? `image-${index + 1}`,
            type: attachment.contentType,
            cardType: attachment.contentType?.startsWith("image/")
              ? "image"
              : undefined,
            url: attachment.url,
            status: "done",
          }))}
        />
      )}
      {message.ingestTexts?.map((text, index) => (
        <Collapse
          key={index}
          size="small"
          items={[{
            key: "content",
            label: t("chat.parsed.content.item", { index: index + 1 }),
            children: <pre className="whitespace-pre-wrap text-xs">{text}</pre>,
          }]}
        />
      ))}
      {orderedParts.map((part, index) => {
        if (part.type === "reasoning") {
          return (
            <ThoughtChain
              key={`reasoning-${index}`}
              items={[{
                key: String(index),
                title: t("chat.reasoning"),
                icon: <RobotOutlined />,
                collapsible: true,
                content: (
                  <div className="whitespace-pre-wrap text-xs">{part.reasoning}</div>
                ),
              }]}
            />
          );
        }
        if (part.type === "text") {
          return part.text ? (
            <MarkdownRenderer key={`text-${index}`}>{part.text}</MarkdownRenderer>
          ) : null;
        }
        if (part.type === "tool-invocation") {
          return (
            <ToolSteps
              key={`tool-${index}`}
              invocations={[part.toolInvocation]}
            />
          );
        }
        return null;
      })}
      {!hasTextPart && message.content && (
        <MarkdownRenderer>{message.content}</MarkdownRenderer>
      )}
      {!hasToolPart && message.toolInvocations && message.toolInvocations.length > 0 && (
        <ToolSteps invocations={message.toolInvocations} />
      )}
    </div>
  );
}

export function Chat({
  messages,
  input,
  handleInputChange,
  handleSubmit,
  isGenerating,
  isProcessing = false,
  stop,
  className,
  files,
  setFiles,
  allowAttachments = false,
  placeholder,
  approval = null,
  onApprove,
  onDeny,
}: ChatProps) {
  const senderRef = useRef<SenderRef>(null);
  const attachmentsRef = useRef<AttachmentsRef>(null);
  const lastCompositionEndAtRef = useRef(Number.NEGATIVE_INFINITY);
  const [previewUrls, setPreviewUrls] = useState<Map<File, string>>(new Map());

  useEffect(() => {
    // Sender does not currently expose textarea ARIA props. Keep this stable
    // label for accessibility and the existing browser integration contract.
    senderRef.current?.inputElement?.setAttribute(
      "aria-label",
      "Write your prompt here",
    );
  }, []);

  useEffect(() => {
    const next = new Map<File, string>();
    for (const file of files ?? []) {
      if (file.type.startsWith("image/")) next.set(file, URL.createObjectURL(file));
    }
    setPreviewUrls(next);
    return () => {
      for (const url of next.values()) URL.revokeObjectURL(url);
    };
  }, [files]);

  const focusSender = () => {
    senderRef.current?.focus({ preventScroll: true, cursor: "end" });
  };

  const addFiles = (nextFiles: File[]) => {
    if (!allowAttachments || !setFiles || nextFiles.length === 0) return;
    setFiles((current) => [...(current ?? []), ...nextFiles]);
  };

  const openFilePicker = () => {
    const restoreFocus = () => window.requestAnimationFrame(focusSender);
    window.addEventListener("focus", restoreFocus, { once: true });
    attachmentsRef.current?.select({ accept: ACCEPTED_FILES, multiple: true });
    window.setTimeout(focusSender, 0);
  };

  const attachmentItems = useMemo<UploadFile[]>(
    () =>
      (files ?? []).map((file, index) => ({
        uid: `${file.name}-${file.lastModified}-${index}`,
        name: file.name,
        size: file.size,
        type: file.type,
        cardType: file.type.startsWith("image/") ? "image" : undefined,
        status: "done",
        thumbUrl: previewUrls.get(file),
        url: previewUrls.get(file),
        originFileObj: file as UploadFile["originFileObj"],
      })),
    [files, previewUrls],
  );

  const bubbleItems = useMemo<BubbleItemType[]>(() => {
    const items: BubbleItemType[] = messages.map((message) => ({
      key: message.id,
      role: message.role === "user" ? "user" : "ai",
      content: message,
      streaming: isGenerating && message === messages.at(-1),
      footer: message.createdAt ? (
        <Flex gap={4} align="center">
          <Typography.Text type="secondary" className="text-xs">
            {message.createdAt.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Typography.Text>
          {message.role !== "user" && (
            <Tooltip title={t("chat.copy")}>
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => void navigator.clipboard.writeText(message.content)}
              />
            </Tooltip>
          )}
        </Flex>
      ) : undefined,
    }));
    if (isProcessing) {
      items.push({
        key: "processing",
        role: "ai",
        content: { id: "processing", role: "assistant", content: "" },
        loading: true,
      });
    }
    return items;
  }, [isGenerating, isProcessing, messages]);

  return (
    <div
      className={`grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 ${className ?? ""}`}
      onDragOver={(event) => {
        if (allowAttachments) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!allowAttachments) return;
        event.preventDefault();
        addFiles(Array.from(event.dataTransfer.files));
      }}
      onCompositionEndCapture={() => {
        lastCompositionEndAtRef.current = performance.now();
      }}
    >
      <Bubble.List
        autoScroll
        className="min-h-0"
        items={bubbleItems}
        role={{
          user: {
            placement: "end",
            variant: "filled",
            shape: "default",
            avatar: <UserOutlined />,
            styles: {
              content: {
                display: "flex",
                alignItems: "center",
                minHeight: 32,
                padding: "4px 12px",
              },
            },
            contentRender: (message: ChatMessage) => <MessageContent message={message} />,
          },
          ai: {
            placement: "start",
            variant: "filled",
            avatar: <RobotOutlined />,
            loadingRender: () => (
              <Flex gap={8} align="center">
                <Spin size="small" />
                <span>{t("chat.processing")}</span>
              </Flex>
            ),
            contentRender: (message: ChatMessage) => <MessageContent message={message} />,
          },
        }}
      />

      <Sender
        ref={senderRef}
        rootClassName="favai-sender"
        value={input}
        loading={isGenerating}
        placeholder={placeholder}
        submitType="enter"
        autoSize={{ minRows: 1, maxRows: 8 }}
        onChange={handleInputChange}
        onSubmit={handleSubmit}
        onCancel={stop}
        onPaste={(event) => {
          if (!allowAttachments) return;
          const text = event.clipboardData.getData("text");
          if (text.length > 500) {
            event.preventDefault();
            addFiles([new File([text], "Pasted text", { type: "text/plain" })]);
            return;
          }
          const pastedFiles = Array.from(event.clipboardData.items)
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
          addFiles(pastedFiles);
        }}
        onKeyDown={(event) => {
          const justFinishedComposition =
            event.key === "Enter" &&
            performance.now() - lastCompositionEndAtRef.current < 100;
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229 ||
            justFinishedComposition
          ) {
            return false;
          }
        }}
        header={
          <div className="flex flex-col gap-2">
            {approval && onApprove && onDeny && (
              <ApprovalPrompt
                request={approval}
                onApprove={onApprove}
                onDeny={onDeny}
              />
            )}
            {attachmentItems.length > 0 ? (
              <Attachments
                ref={attachmentsRef}
                items={attachmentItems}
                overflow="scrollX"
                beforeUpload={(file) => {
                  addFiles([file]);
                  window.requestAnimationFrame(focusSender);
                  return Upload.LIST_IGNORE;
                }}
                onRemove={(removed) => {
                  const index = attachmentItems.findIndex((item) => item.uid === removed.uid);
                  setFiles?.((current) => {
                    const next = (current ?? []).filter((_, itemIndex) => itemIndex !== index);
                    return next.length > 0 ? next : null;
                  });
                  return false;
                }}
              />
            ) : (
              <Attachments
                ref={attachmentsRef}
                className="hidden"
                items={[]}
                beforeUpload={(file) => {
                  addFiles([file]);
                  window.requestAnimationFrame(focusSender);
                  return Upload.LIST_IGNORE;
                }}
              />
            )}
          </div>
        }
        suffix={(_originalNode, { components }) => {
          const { LoadingButton, SendButton } = components;
          const actionStyle = { width: 32, height: 32, borderRadius: 3 };
          return (
          <Flex gap={4} align="center">
            {allowAttachments && (
              <Button
                type="text"
                icon={<PaperClipOutlined />}
                title={t("chat.attach")}
                aria-label={t("chat.attach")}
                style={actionStyle}
                onClick={openFilePicker}
              />
            )}
            {isGenerating ? (
              <LoadingButton aria-label="Stop generating" style={actionStyle} />
            ) : (
              <SendButton
                type="primary"
                aria-label="Send message"
                disabled={!input.trim() && attachmentItems.length === 0}
                style={actionStyle}
              />
            )}
          </Flex>
          );
        }}
      />
    </div>
  );
}
