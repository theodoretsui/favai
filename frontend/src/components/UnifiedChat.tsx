import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  api,
  type Config,
  type Session,
  type SessionSummary,
  type Status,
  type Transaction,
} from "@/api";
import { t } from "@/i18n";
import { getLedgerData } from "@/agent/favaApi";
import { buildImportPrompt, UNIFIED_SYSTEM_PROMPT } from "@/agent/prompts";
import { createUnifiedAgent } from "@/agent/factory";
import {
  ingestContentBlock,
  toChatMessages,
} from "@/agent/toChatMessages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Chat } from "@/components/ui/chat";
import { ProposalTable } from "@/components/ProposalTable";
import { SessionSidebar } from "@/components/SessionSidebar";
import { ImportedTransactions } from "@/components/ImportedTransactions";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";

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
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const agentRef = useRef<Agent | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const transactionsRef = useRef<Transaction[] | null>(null);
  const dirtyRef = useRef(false);
  const pendingProposalRef = useRef<Transaction[] | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const editSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSessions = useCallback(() => {
    api
      .listSessions()
      .then((result) => setSessions(result.sessions))
      .catch(showError);
  }, []);

  // Load ledger accounts on mount.
  useEffect(() => {
    try {
      const data = getLedgerData();
      setAccounts(data.accounts);
    } catch {
      // AccountCombobox falls back to free-form input.
    }
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // Create the unified agent when config is available. Subscribe for the
  // component lifetime so every streaming event re-renders the derived list.
  useEffect(() => {
    if (!config) return;
    const agent = createUnifiedAgent(config, (txns) => {
      applyProposal(txns);
    });
    if (sessionRef.current) {
      agent.state.messages = sessionRef.current.messages as AgentMessage[];
    }
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

  function setSession(session: Session | null) {
    sessionRef.current = session;
    setCurrentSession(session);
  }

  function replaceTransactions(value: Transaction[] | null) {
    transactionsRef.current = value;
    setTransactions(value);
  }

  function replaceDirty(value: boolean) {
    dirtyRef.current = value;
    setDirty(value);
  }

  function replacePendingProposal(value: Transaction[] | null) {
    pendingProposalRef.current = value;
    setPendingProposal(value);
  }

  function persistSession() {
    saveChainRef.current = saveChainRef.current.then(async () => {
      const session = sessionRef.current;
      const agent = agentRef.current;
      if (!session || !agent || agent.state.isStreaming) return;
      const saved = await api.saveSession({
        session_id: session.id,
        expected_revision: session.revision,
        messages: agent.state.messages,
        proposal: transactionsRef.current,
        proposal_dirty: dirtyRef.current,
        pending_proposal: pendingProposalRef.current,
      });
      setSession(saved);
      await refreshSessions();
    }).catch((err: unknown) => {
      showError(err);
    });
    return saveChainRef.current;
  }

  function scheduleEditSave() {
    if (editSaveTimerRef.current) clearTimeout(editSaveTimerRef.current);
    editSaveTimerRef.current = setTimeout(() => {
      void persistSession();
    }, 750);
  }

  function applyProposal(proposal: Transaction[] | null) {
    if (!proposal) return;
    if (transactionsRef.current !== null && dirtyRef.current) {
      replacePendingProposal(proposal);
    } else {
      replaceTransactions(proposal);
    }
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
    setSession(null);
    replaceTransactions(null);
    replaceDirty(false);
    replacePendingProposal(null);
    setFiles(null);
    bump();
  }

  async function openSession(sessionId: string) {
    if (isProcessing || agentRef.current?.state.isStreaming) return;
    try {
      if (editSaveTimerRef.current) clearTimeout(editSaveTimerRef.current);
      await persistSession();
      const session = await api.getSession(sessionId);
      const agent = agentRef.current;
      if (!agent) return;
      agent.reset();
      agent.state.messages = session.messages as AgentMessage[];
      agent.state.systemPrompt = UNIFIED_SYSTEM_PROMPT;
      setSession(session);
      replaceTransactions(session.proposal);
      replaceDirty(Boolean(session.proposal_dirty));
      replacePendingProposal(session.pending_proposal);
      setFiles(null);
      bump();
    } catch (err) {
      showError(err);
    }
  }

  async function newSession() {
    if (isProcessing || agentRef.current?.state.isStreaming) return;
    if (editSaveTimerRef.current) clearTimeout(editSaveTimerRef.current);
    await persistSession();
    resetSession();
  }

  async function renameHistory(session: SessionSummary) {
    const title = window
      .prompt(t("history.rename.prompt"), session.title)
      ?.trim();
    if (!title || title === session.title) return;
    try {
      const renamed = await api.renameSession(session.id, title);
      if (sessionRef.current?.id === renamed.id) setSession(renamed);
      refreshSessions();
    } catch (err) {
      showError(err);
    }
  }

  async function deleteHistory(session: SessionSummary) {
    if (!window.confirm(t("history.delete.confirm"))) return;
    try {
      await api.deleteSession(session.id);
      if (sessionRef.current?.id === session.id) resetSession();
      refreshSessions();
    } catch (err) {
      showError(err);
    }
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
      if (!sessionRef.current) {
        const fallbackTitle = hasFiles
          ? t("unified.import.title")
          : t("history.new");
        const title = (currentInput || fallbackTitle).slice(0, 40);
        const created = await api.createSession(title, config);
        setSession(created);
        refreshSessions();
      }
      let images: { data: string; mimeType: string }[] = [];

      let ingestTexts: string[] = [];

      if (hasFiles) {
        // Import mode: ingest files, build import prompt.
        setIsProcessing(true);
        try {
          const ingestResult = await api.ingest(files ?? [], "");
          for (const warning of ingestResult.warnings) {
            toast.warning(`${t("warning.title")}: ${warning}`);
          }
          const { accounts: accs, currencies, payees } = getLedgerData();
          const currentDate = new Date().toISOString().slice(0, 10);
          const importContext = buildImportPrompt(
            accs,
            currencies,
            payees,
            currentDate,
            ingestResult.warnings,
          );
          agent.state.systemPrompt = `${UNIFIED_SYSTEM_PROMPT}\n\n${importContext}`;
          ingestTexts = ingestResult.texts;

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

      if (ingestTexts.length > 0) {
        await agent.prompt({
          role: "user",
          timestamp: Date.now(),
          content: [
            { type: "text", text: currentInput },
            ...ingestTexts.map(ingestContentBlock),
            ...images.map((image) => ({ type: "image" as const, ...image })),
          ],
        });
      } else {
        await agent.prompt(
          currentInput,
          images.length > 0 ? (images as never) : undefined,
        );
      }

      if (agent.state.errorMessage) {
        throw new Error(agent.state.errorMessage);
      }
      await persistSession();
    } catch (err) {
      showError(err);
      await persistSession();
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
      const result = await api.importConfirm(transactions, currentSession?.id);
      toast.success(t("confirm.success", { count: result.inserted }));
      replaceDirty(false);
      replacePendingProposal(null);
      if (currentSession) {
        setSession(await api.getSession(currentSession.id));
      }
      await refreshSessions();
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
    <div className="flex min-h-0 flex-col gap-3 md:flex-row">
      <SessionSidebar
        sessions={sessions}
        currentId={currentSession?.id ?? null}
        disabled={isProcessing || isGenerating}
        onCreate={() => void newSession()}
        onOpen={(id) => void openSession(id)}
        onRename={(session) => void renameHistory(session)}
        onDelete={(session) => void deleteHistory(session)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
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

      {/* Confirmed imports are immutable history, not an active proposal. */}
      {transactions && currentSession?.confirmed_at && (
        <ImportedTransactions
          transactions={transactions}
          confirmedCount={currentSession.confirmed_count}
        />
      )}

      {/* Editable proposal table */}
      {transactions && !currentSession?.confirmed_at && (
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
                  replaceTransactions(pendingProposal);
                  replacePendingProposal(null);
                  replaceDirty(false);
                  scheduleEditSave();
                }}
              >
                {t("proposal.new.apply")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  replacePendingProposal(null);
                  scheduleEditSave();
                }}
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
                replaceTransactions(next);
                replaceDirty(true);
                scheduleEditSave();
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
    </div>
  );
}
