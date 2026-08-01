"use client"

import {
  forwardRef,
  useCallback,
  type ReactElement,
} from "react"
import { ArrowDown, Loader2, ThumbsDown, ThumbsUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { useAutoScroll } from "@/hooks/use-auto-scroll"
import { Button } from "@/components/ui/button"
import { type Message } from "@/components/ui/chat-message"
import { CopyButton } from "@/components/ui/copy-button"
import { MessageInput } from "@/components/ui/message-input"
import { MessageList } from "@/components/ui/message-list"
import { t } from "@/i18n"

export { type Message } from "@/components/ui/chat-message"

interface ChatProps {
  messages: Message[]
  input: string
  handleInputChange: React.ChangeEventHandler<HTMLTextAreaElement>
  handleSubmit: (event?: { preventDefault?: () => void }) => void
  isGenerating: boolean
  isProcessing?: boolean
  stop?: () => void
  className?: string
  onRateResponse?: (
    messageId: string,
    rating: "thumbs-up" | "thumbs-down",
  ) => void
  files?: File[] | null
  setFiles?: React.Dispatch<React.SetStateAction<File[] | null>>
  allowAttachments?: boolean
  placeholder?: string
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
  onRateResponse,
  files,
  setFiles,
  allowAttachments = false,
  placeholder,
}: ChatProps) {
  const lastMessage = messages.at(-1)
  const isTyping = lastMessage?.role === "user"

  const messageOptions = useCallback(
    (message: Message) => ({
      actions: onRateResponse ? (
        <>
          <div className="border-r pr-1">
            <CopyButton
              content={message.content}
              copyMessage="Copied response to clipboard!"
              className="h-6 w-6 hover:bg-muted"
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => onRateResponse(message.id, "thumbs-up")}
          >
            <ThumbsUp className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => onRateResponse(message.id, "thumbs-down")}
          >
            <ThumbsDown className="size-4" />
          </Button>
        </>
      ) : (
        <CopyButton
          content={message.content}
          copyMessage="Copied response to clipboard!"
          className="h-6 w-6 hover:bg-muted"
        />
      ),
    }),
    [onRateResponse],
  )

  return (
    <ChatContainer className={className}>
      {messages.length > 0 || isProcessing ? (
        <ChatMessages messages={messages} isProcessing={isProcessing}>
          {messages.length > 0 ? (
            <MessageList
              messages={messages}
              isTyping={isTyping}
              messageOptions={messageOptions}
            />
          ) : null}
          {isProcessing ? (
            <div className="mt-2 flex w-fit items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t("chat.processing")}</span>
            </div>
          ) : null}
        </ChatMessages>
      ) : null}

      <ChatForm className="mt-auto" handleSubmit={handleSubmit}>
        <MessageInput
          value={input}
          onChange={handleInputChange}
          placeholder={placeholder}
          allowAttachments={allowAttachments}
          files={files ?? null}
          setFiles={setFiles ?? (() => {})}
          stop={stop}
          isGenerating={isGenerating}
        />
      </ChatForm>
    </ChatContainer>
  )
}
Chat.displayName = "Chat"

export function ChatMessages({
  messages,
  isProcessing = false,
  children,
}: React.PropsWithChildren<{
  messages: Message[]
  isProcessing?: boolean
}>) {
  const {
    containerRef,
    scrollToBottom,
    handleScroll,
    shouldAutoScroll,
    handleTouchStart,
  } = useAutoScroll([messages, isProcessing])

  return (
    <div
      className="grid grid-cols-1 overflow-y-auto pb-4"
      ref={containerRef}
      onScroll={handleScroll}
      onTouchStart={handleTouchStart}
    >
      <div className="max-w-full [grid-column:1/1] [grid-row:1/1]">
        {children}
      </div>

      {!shouldAutoScroll && (
        <div className="pointer-events-none flex flex-1 items-end justify-end [grid-column:1/1] [grid-row:1/1]">
          <div className="sticky bottom-0 left-0 flex w-full justify-end">
            <Button
              onClick={scrollToBottom}
              className="pointer-events-auto rounded-full ease-in-out animate-in fade-in-0 slide-in-from-bottom-1"
              size="icon-sm"
              variant="ghost"
            >
              <ArrowDown />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export const ChatContainer = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("grid h-full w-full grid-rows-[1fr_auto]", className)}
      {...props}
    />
  )
})
ChatContainer.displayName = "ChatContainer"

interface ChatFormProps {
  className?: string
  handleSubmit: (event?: { preventDefault?: () => void }) => void
  children: ReactElement
}

export const ChatForm = forwardRef<HTMLFormElement, ChatFormProps>(
  ({ children, handleSubmit, className }, ref) => {
    return (
      <form ref={ref} onSubmit={handleSubmit} className={className}>
        {children}
      </form>
    )
  },
)
ChatForm.displayName = "ChatForm"
