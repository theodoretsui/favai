import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { api, type Config, type Status, type Transaction } from "@/api";
import { t } from "@/i18n";
import { getLedgerData } from "@/agent/favaApi";
import { buildImportPrompt, UNIFIED_SYSTEM_PROMPT } from "@/agent/prompts";
import { createUnifiedAgent } from "@/agent/factory";
import { toChatMessages } from "@/agent/toChatMessages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Chat } from "@/components/ui/chat";
import { ProposalTable } from "@/components/ProposalTable";
import type { Agent } from "@earendil-works/pi-agent-core";

export function UnifiedChat({
  config,
  status,
}: {
  config: Config | null;
  status: Status | null;
}) {
  // Re-render trigger: bumped on every agent event so the derived message list
  // reflects the latest ``agent.state``. The agent transcript is the single
  // source of truth -- we no longer mirror it into local state.
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const [isProcessing, setIsProcessing] = useState(false);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[] | null>(null);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<Transaction[] | null>(
    null,
  );
  const [accounts, setAccounts] = useState<string[]>([]);
  const agentRef = useRef<Agent | null>(null);

  // Load ledger accounts on mount.
  useEffect(() => {
    try {
      const data = getLedgerData();
      setAccounts(data.accounts);
    } catch {
      // AccountCombobox falls back to free-form input.
    }
  }, []);

  // Create the unified agent when config is available. Subscribe for the
  // component lifetime so every streaming event re-renders the derived list.
  useEffect(() => {
    if (!config) return;
    const agent = createUnifiedAgent(config, (txns) => {
      applyProposal(txns);
    });
    agentRef.current = agent;
    const unsub = agent.subscribe(bump);
    return () => {
      unsub();
      agent.abort();
      agentRef.current = null;
    };
  }, [config, bump]);

  const showError = useCallback((err: unknown) => {
    toast.error(
      t("error.generic", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }, []);

  function applyProposal(proposal: Transaction[] | null) {
    if (!proposal) return;
    setTransactions((current) => {
      if (current !== null && dirty) {
        setPendingProposal(proposal);
        return current;
      }
      return proposal;
    });
  }

  // Wrap setFiles: warn immediately when an image is attached but neither
  // vision nor OCR can read it.
  const handleFilesChange: Dispatch<SetStateAction<File[] | null>> = useCallback(
    (next) => {
      setFiles((prev) => {
        const resolved =
          typeof next === "function"
            ? (next as (p: File[] | null) => File[] | null)(prev)
            : next;
        const prevImages = new Set(
          (prev ?? [])
            .filter((f) => f.type.startsWith("image/"))
            .map((f) => `${f.name}:${f.size}:${f.lastModified}`),
        );
        const addedImage = (resolved ?? []).some(
          (f) =>
            f.type.startsWith("image/") &&
            !prevImages.has(`${f.name}:${f.size}:${f.lastModified}`),
        );
        if (
          addedImage &&
          !config?.vision &&
          !(status?.ocr_available ?? false)
        ) {
          toast.warning(
            `${t("warning.title")}: ${t("warning.image.no_reader")}`,
          );
        }
        return resolved;
      });
    },
    [config?.vision, status?.ocr_available],
  );

  function resetSession() {
    agentRef.current?.reset();
    setTransactions(null);
    setDirty(false);
    setPendingProposal(null);
    setFiles(null);
    bump();
  }

  async function handleSubmit(event?: { preventDefault?: () => void }) {
    event?.preventDefault?.();
    const content = input.trim();
    const hasFiles = (files?.length ?? 0) > 0;
    const agent = agentRef.current;
    if ((!content && !hasFiles) || !agent || !config) return;

    const currentInput = content;
    setInput("");
    setFiles(null);

    try {
      let images: { data: string; mimeType: string }[] = [];

      // The text shown in the user's chat bubble is always just what they
      // typed. The bill-materials context is routed through the agent's
      // systemPrompt (read by createContextSnapshot) so it reaches the LLM
      // without polluting the visible transcript.
      let displayText = currentInput;

      if (hasFiles) {
        // Import mode: ingest files, build import prompt.
        setIsProcessing(true);
        try {
          const ingestResult = await api.ingest(files ?? [], currentInput);
          for (const warning of ingestResult.warnings) {
            toast.warning(`${t("warning.title")}: ${warning}`);
          }
          const { accounts: accs, currencies, payees } = getLedgerData();
          const currentDate = new Date().toISOString().slice(0, 10);
          const importContext = buildImportPrompt(
            accs,
            currencies,
            payees,
            ingestResult.texts,
            currentDate,
          );
          agent.state.systemPrompt = `${UNIFIED_SYSTEM_PROMPT}\n\n${importContext}`;
          images = ingestResult.images;
          if (!config.vision && images.length > 0) {
            toast.warning(
              t("warning.vision.disabled.images_ignored", {
                count: images.length,
              }),
            );
            images = [];
          }
        } finally {
          setIsProcessing(false);
        }
      } else {
        // Chat mode: keep the base system prompt, send user message directly.
        agent.state.systemPrompt = UNIFIED_SYSTEM_PROMPT;
      }

      await agent.prompt(
        displayText,
        images.length > 0 ? (images as never) : undefined,
      );

      if (agent.state.errorMessage) {
        throw new Error(agent.state.errorMessage);
      }
    } catch (err) {
      showError(err);
    }
  }

  function handleInputChange(
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) {
    setInput(e.target.value);
  }

  function abort() {
    agentRef.current?.abort();
  }

  async function confirm() {
    if (!transactions) return;
    try {
      const result = await api.importConfirm(transactions);
      toast.success(t("confirm.success", { count: result.inserted }));
      resetSession();
    } catch (err) {
      showError(err);
    }
  }

  async function discard() {
    resetSession();
    toast.success(t("discard.done"));
  }

  // ── Derive Chat messages from agent state ──────────────────────────────

  const agent = agentRef.current;
  const chatMessages = agent
    ? toChatMessages(agent.state.messages, agent.state.streamingMessage)
    : [];
  const isGenerating = agent?.state.isStreaming ?? false;

  // ── Render ──────────────────────────────────────────────────────────────

  const isConfigured = status?.configured ?? false;

  return (
    <div className="flex flex-col gap-4">
      {/* Callout for config status */}
      {!isConfigured && (
        <Callout variant="warning">
          {t("unified.callout.not_configured")}
        </Callout>
      )}

      {/* Main Chat area */}
      <div className="flex h-[32rem] max-h-[calc(100vh-12rem)] flex-col rounded-xl border p-4">
        <Chat
          messages={chatMessages}
          input={input}
          handleInputChange={handleInputChange}
          handleSubmit={handleSubmit}
          isGenerating={isGenerating}
          isProcessing={isProcessing}
          stop={abort}
          allowAttachments
          files={files}
          setFiles={handleFilesChange}
          placeholder={
            isConfigured
              ? t("chat.input.placeholder")
              : t("chat.not.configured")
          }
        />
      </div>

      {/* Proposal table */}
      {transactions && (
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

          {transactions.length > 0 ? (
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

          <div className="flex gap-2">
            <Button
              onClick={confirm}
              disabled={isGenerating || transactions.length === 0}
            >
              {t("confirm.submit")}
            </Button>
            <Button variant="outline" onClick={discard} disabled={isGenerating}>
              {t("discard.submit")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
