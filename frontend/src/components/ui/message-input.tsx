"use client"

import React, { useRef, useState } from "react"
import { Sender } from "@ant-design/x"
import type { SenderRef } from "@ant-design/x/es/sender"
import { ConfigProvider, Upload } from "antd"
import { AnimatePresence, motion } from "framer-motion"
import { Paperclip } from "lucide-react"

import { cn } from "@/lib/utils"
import { t } from "@/i18n"
import { Button } from "@/components/ui/button"
import { FilePreview } from "@/components/ui/file-preview"

const ACCEPTED_FILES = ".txt,.md,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.pdf"

interface MessageInputProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  stop?: () => void
  isGenerating: boolean
  allowAttachments?: boolean
  files?: File[] | null
  setFiles?: React.Dispatch<React.SetStateAction<File[] | null>>
  placeholder?: string
  className?: string
}

export function MessageInput({
  value,
  onValueChange,
  onSubmit,
  stop,
  isGenerating,
  allowAttachments = false,
  files,
  setFiles,
  placeholder = t("chat.input.placeholder"),
  className,
}: MessageInputProps) {
  const [isDragging, setIsDragging] = useState(false)
  const senderRef = useRef<SenderRef>(null)
  const lastCompositionEndAtRef = useRef(Number.NEGATIVE_INFINITY)

  const addFiles = (nextFiles: File[]) => {
    if (!allowAttachments || !setFiles || nextFiles.length === 0) return
    setFiles((currentFiles) => [...(currentFiles ?? []), ...nextFiles])
  }

  const focusSender = () => {
    senderRef.current?.focus({ preventScroll: true, cursor: "end" })
  }

  const focusSenderAfterPicker = () => {
    window.requestAnimationFrame(focusSender)
  }

  const onDragOver = (event: React.DragEvent) => {
    if (!allowAttachments) return
    event.preventDefault()
    setIsDragging(true)
  }

  const onDragLeave = (event: React.DragEvent) => {
    if (!allowAttachments) return
    event.preventDefault()
    setIsDragging(false)
  }

  const onDrop = (event: React.DragEvent) => {
    setIsDragging(false)
    if (!allowAttachments) return
    event.preventDefault()
    addFiles(Array.from(event.dataTransfer.files))
  }

  const onPaste = (event: React.ClipboardEvent<HTMLElement>) => {
    if (!allowAttachments) return

    const text = event.clipboardData.getData("text")
    if (text.length > 500) {
      event.preventDefault()
      addFiles([
        new File([text], "Pasted text", {
          type: "text/plain",
          lastModified: Date.now(),
        }),
      ])
      return
    }

    const pastedFiles = Array.from(event.clipboardData.items)
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    if (pastedFiles.length > 0) addFiles(pastedFiles)
  }

  const showFileList = allowAttachments && files && files.length > 0
  const canSubmit = value.length > 0 || Boolean(showFileList)

  const attachmentList = showFileList ? (
    <div className="overflow-x-auto px-3 py-2">
      <div className="flex space-x-3">
        <AnimatePresence mode="popLayout">
          {files.map((file) => (
            <FilePreview
              key={file.name + String(file.lastModified)}
              file={file}
              onRemove={() => {
                setFiles?.((currentFiles) => {
                  if (!currentFiles) return null
                  const filtered = currentFiles.filter((item) => item !== file)
                  return filtered.length > 0 ? filtered : null
                })
              }}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  ) : (
    false
  )

  return (
    <div
      className="relative w-full"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onCompositionEndCapture={() => {
        lastCompositionEndAtRef.current = performance.now()
      }}
    >
      <ConfigProvider
        prefixCls="favai-root"
        iconPrefixCls="favai-root-icon"
        theme={{
          token: {
            colorPrimary: "var(--primary)",
            colorText: "var(--foreground)",
            colorTextPlaceholder: "var(--muted-foreground)",
            colorBgContainer: "var(--background)",
            colorBorder: "var(--border)",
            borderRadius: 12,
            fontFamily: "inherit",
          },
        }}
      >
        <Sender
          ref={senderRef}
          rootClassName={cn("favai-sender", className)}
          value={value}
          onChange={onValueChange}
          onSubmit={onSubmit}
          onCancel={stop}
          onPaste={onPaste}
          onKeyDown={(event) => {
            // Safari can emit Enter immediately after compositionend.
            // Remove this guard once ant-design/x#1732 ships.
            const justFinishedComposition =
              event.key === "Enter" &&
              performance.now() - lastCompositionEndAtRef.current < 100

            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 ||
              justFinishedComposition
            ) {
              return false
            }
          }}
          loading={isGenerating}
          submitType="enter"
          autoSize={{ minRows: 1, maxRows: 8 }}
          placeholder={placeholder}
          header={attachmentList}
          suffix={(_originalNode, { components }) => {
            const { LoadingButton, SendButton } = components
            return (
              <div className="flex items-center gap-2">
                {allowAttachments && (
                  <Upload
                    accept={ACCEPTED_FILES}
                    multiple
                    showUploadList={false}
                    beforeUpload={(file) => {
                      addFiles([file])
                      focusSenderAfterPicker()
                      return Upload.LIST_IGNORE
                    }}
                  >
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label="Attach a file"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={focusSenderAfterPicker}
                    >
                      <Paperclip />
                    </Button>
                  </Upload>
                )}
                {isGenerating ? (
                  <LoadingButton
                    aria-label="Stop generating"
                    disabled={!stop}
                  />
                ) : (
                  <SendButton
                    aria-label="Send message"
                    disabled={!canSubmit}
                  />
                )}
              </div>
            )
          }}
        />
      </ConfigProvider>

      {allowAttachments && <FileUploadOverlay isDragging={isDragging} />}
    </div>
  )
}
MessageInput.displayName = "MessageInput"

interface FileUploadOverlayProps {
  isDragging: boolean
}

function FileUploadOverlay({ isDragging }: FileUploadOverlayProps) {
  return (
    <AnimatePresence>
      {isDragging && (
        <motion.div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center space-x-2 rounded-xl border border-dashed border-border bg-background text-sm text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          aria-hidden
        >
          <Paperclip className="h-4 w-4" />
          <span>{t("chat.attach.hint")}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
