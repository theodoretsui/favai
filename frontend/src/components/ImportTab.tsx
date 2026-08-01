import { useCallback, useEffect, useRef, useState, type FC } from "react";
import { ChevronRight, SendIcon, UploadIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { api, type Config, type Status, type Transaction } from "@/api";
import { t } from "@/i18n";
import {
  getLedgerData,
} from "@/agent/favaApi";
import { buildImportPrompt } from "@/agent/prompts";
import { createImportAgent } from "@/agent/factory";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { ProposalTable } from "@/components/ProposalTable";
import type { Agent } from "@earendil-works/pi-agent-core";

const ACCEPT =
  ".txt,.md,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.pdf";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Parsed file contents (OCR / text extraction) shown in a collapsible block */
  ingestTexts?: string[];
}

const ParsedContentBlock: FC<{ texts: string[] }> = ({ texts }) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group mx-2 mb-1.5 overflow-hidden rounded-md border border-primary-foreground/20 bg-primary-foreground/10"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1 text-xs text-primary-foreground/70 hover:text-primary-foreground"
        >
          <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          <span>{t("chat.parsed.content")}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-primary-foreground/20 px-2 py-1.5 text-xs text-primary-foreground/80 whitespace-pre-wrap">
          {texts.join("\n\n")}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export function ImportTab({
  status,
  config,
}: {
  status: Status | null;
  config: Config | null;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<Transaction[] | null>(
    null,
  );
  const [accounts, setAccounts] = useState<string[]>([]);
  const agentRef = useRef<Agent | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const data = getLedgerData();
      setAccounts(data.accounts);
    } catch {
      // The account dropdown falls back to free-form input.
    }
  }, []);

  const showWarnings = useCallback((warnings: string[]) => {
    for (const warning of warnings) {
      toast.warning(`${t("warning.title")}: ${warning}`);
    }
  }, []);

  const showError = useCallback((err: unknown) => {
    toast.error(
      t("error.generic", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }, []);

  function applyProposal(proposal: Transaction[] | null) {
    if (!proposal) {
      return;
    }
    setTransactions((current) => {
      if (current !== null && dirty) {
        setPendingProposal(proposal);
        return current;
      }
      return proposal;
    });
  }

  function reset() {
    agentRef.current?.abort();
    agentRef.current = null;
    setFiles([]);
    setText("");
    setMessages([]);
    setWaiting(false);
    setFeedback("");
    setTransactions(null);
    setDirty(false);
    setPendingProposal(null);
  }

  const userInputRef = useRef("");

  async function startImport() {
    if (files.length === 0 && text.trim() === "") {
      toast.error(t("import.start.empty"));
      return;
    }
    if (!config) {
      toast.error(t("import.not.configured"));
      return;
    }
    setWaiting(true);

    // Store user's original input for chat display
    const fileNames = files.map((f) => f.name);
    const summaryParts: string[] = [];
    if (text.trim()) summaryParts.push(text.trim());
    if (fileNames.length > 0) summaryParts.push(`[${fileNames.join(", ")}]`);
    userInputRef.current = summaryParts.join(" ");
    // Show the user's input immediately
    setMessages([]);

    try {
      // 1. Ingest
      const ingestResult = await api.ingest(files, text.trim());
      showWarnings(ingestResult.warnings);

      // 2. Build prompt with current date
      const { accounts: accs, currencies, payees } = getLedgerData();
      const currentDate = new Date().toISOString().slice(0, 10);
      const prompt = buildImportPrompt(
        accs,
        currencies,
        payees,
        currentDate,
        ingestResult.warnings,
      );
      // Append bill materials to the prompt since they are sent as the
      // user message (not hidden in a system prompt).
      const billTexts = ingestResult.texts.join("\n\n");
      const billPrompt = billTexts ? `${prompt}\n\n${billTexts}` : prompt;

      // 3. Show user message immediately with parsed file contents
      const fileTexts = ingestResult.texts;
      setMessages([
        {
          role: "user",
          text: userInputRef.current,
          ingestTexts:
            fileTexts.length > 0
              ? [...fileTexts]
              : undefined,
        },
      ]);

      // 4. Create agent
      const agent = createImportAgent(config, (txns) => {
        applyProposal(txns);
      });
      agentRef.current = agent;

      // 5. Subscribe to events — handle assistant messages only
      const unsub = agent.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          const delta = (event.assistantMessageEvent as { delta: string }).delta;
          setMessages((prev) => {
            const msgs = [...prev];
            const last = msgs[msgs.length - 1];
            if (last?.role === "assistant") {
              msgs[msgs.length - 1] = {
                ...last,
                text: last.text + delta,
              };
            } else {
              msgs.push({
                role: "assistant",
                text: delta,
              });
            }
            return msgs;
          });
        }
        if (event.type === "agent_end") {
          setWaiting(false);
        }
      });

      // 6. Prompt
      const images =
        config.vision || ingestResult.images.length === 0
          ? ingestResult.images
          : (toast.warning(
              t("warning.vision.disabled.images_ignored", {
                count: ingestResult.images.length,
              }),
            ),
            []);
      await agent.prompt(
        billPrompt,
        images.length > 0 ? (images as never) : undefined,
      );
      unsub();

      // 6. Check for LLM errors that were not thrown (e.g. upstream API error responses)
      if (agent.state.errorMessage) {
        throw new Error(agent.state.errorMessage);
      }
    } catch (err) {
      showError(err);
      setWaiting(false);
    }
  }

  async function sendFeedback() {
    const content = feedback.trim();
    if (!content) {
      return;
    }
    setFeedback("");
    setMessages((prev) => [...prev, { role: "user", text: content }]);
    setWaiting(true);
    try {
      if (!agentRef.current) {
        return;
      }
      const unsub = agentRef.current.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          const delta = (event.assistantMessageEvent as { delta: string }).delta;
          setMessages((prev) => {
            const msgs = [...prev];
            const last = msgs[msgs.length - 1];
            if (last?.role === "assistant") {
              msgs[msgs.length - 1] = {
                ...last,
                text: last.text + delta,
              };
            } else {
              msgs.push({
                role: "assistant",
                text: delta,
              });
            }
            return msgs;
          });
        }
        if (event.type === "agent_end") {
          setWaiting(false);
        }
      });
      await agentRef.current.prompt(content);
      unsub();
      unsub();

      if (agentRef.current.state.errorMessage) {
        throw new Error(agentRef.current.state.errorMessage);
      }
    } catch (err) {
      showError(err);
      setWaiting(false);
    }
  }

  async function confirm() {
    if (!transactions) {
      return;
    }
    try {
      const result = await api.importConfirm(transactions);
      toast.success(t("confirm.success", { count: result.inserted }));
      reset();
    } catch (err) {
      showError(err);
    }
  }

  async function discard() {
    reset();
    toast.success(t("discard.done"));
  }

  // ── Starting page (no agent running) ──────────────────────────────────
  if (agentRef.current === null) {
    return (
      <div className="flex flex-col gap-4">
        {status && !status.configured && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            {t("import.not.configured")}
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors hover:border-ring hover:bg-muted/50"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
          }}
        >
          <UploadIcon className="size-8 text-muted-foreground" />
          <div className="text-sm font-medium">
            {t("import.dropzone.title")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("import.dropzone.hint")}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              setFiles((prev) => [
                ...prev,
                ...Array.from(e.target.files ?? []),
              ]);
              e.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("import.files.selected", { count: files.length })}
            </span>
            {files.map((file, i) => (
              <Badge key={`${file.name}-${i}`} variant="secondary">
                {file.name}
                <button
                  type="button"
                  className="ml-1 opacity-60 hover:opacity-100"
                  title={t("import.files.remove")}
                  onClick={() =>
                    setFiles((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">
            {t("import.paste.label")}
          </span>
          <Textarea
            rows={6}
            placeholder={t("import.paste.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div>
          <Button onClick={startImport} disabled={waiting}>
            {waiting ? t("chat.extracting") : t("import.start")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Import session page (agent running) ────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <MessageScrollerProvider>
        <MessageScroller className="h-72 rounded-lg border">
        <MessageScrollerViewport>
          <MessageScrollerContent className="p-4">
            {messages.map((message, i) => (
              <MessageScrollerItem key={i}>
                <Message align={message.role === "user" ? "end" : "start"}>
                  <MessageContent>
                    <MessageHeader>
                      {message.role === "user"
                        ? t("chat.you")
                        : t("chat.assistant")}
                    </MessageHeader>
                    <Bubble
                      variant={message.role === "user" ? "default" : "muted"}
                      align={message.role === "user" ? "end" : "start"}
                    >
                      <BubbleContent className="whitespace-pre-wrap">
                        {message.text}
                      </BubbleContent>
                      {message.role === "user" &&
                        message.ingestTexts &&
                        message.ingestTexts.length > 0 && (
                          <ParsedContentBlock texts={message.ingestTexts} />
                        )}
                    </Bubble>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ))}
            {waiting && (
              <MessageScrollerItem scrollAnchor>
                <Marker>
                  <MarkerContent>
                    <span className="shimmer">{t("chat.extracting")}</span>
                  </MarkerContent>
                </Marker>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void sendFeedback();
        }}
      >
        <Input
          className="flex-1"
          placeholder={t("chat.feedback.placeholder")}
          value={feedback}
          disabled={waiting}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <Button
          type="submit"
          size="icon"
          disabled={waiting || feedback.trim() === ""}
        >
          <SendIcon />
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">{t("proposal.title")}</h2>
          {dirty && (
            <Badge variant="secondary">{t("proposal.dirty.badge")}</Badge>
          )}
        </div>

        {pendingProposal && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-accent px-3 py-2 text-sm">
            <span>{t("proposal.new.available")}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTransactions(pendingProposal);
                setPendingProposal(null);
                setDirty(false);
              }}
            >
              {t("proposal.new.apply")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingProposal(null)}
            >
              {t("proposal.new.keep")}
            </Button>
          </div>
        )}

        {transactions && transactions.length > 0 ? (
          <ProposalTable
            transactions={transactions}
            accounts={accounts}
            onChange={(next) => {
              setTransactions(next);
              setDirty(true);
            }}
          />
        ) : (
          <div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {t("proposal.empty")}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          onClick={confirm}
          disabled={waiting || !transactions || transactions.length === 0}
        >
          {t("confirm.submit")}
        </Button>
        <Button variant="outline" onClick={discard} disabled={waiting}>
          {t("discard.submit")}
        </Button>
      </div>
    </div>
  );
}
