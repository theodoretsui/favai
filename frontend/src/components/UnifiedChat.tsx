import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  api,
  type ApiKind,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";

interface ModelChoice {
  provider: string;
  model: string;
}

const DEFAULT_WRITE_PATH = "__fava_default__";

function modelChoiceValue(choice: ModelChoice): string {
  return JSON.stringify([choice.provider, choice.model]);
}

function parseModelChoice(value: string): ModelChoice {
  const [provider, model] = JSON.parse(value) as [string, string];
  return { provider, model };
}

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
  const [writePath, setWritePath] = useState(DEFAULT_WRITE_PATH);
  const [providerConfigs, setProviderConfigs] = useState<Config[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [agentEpoch, setAgentEpoch] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const agentRef = useRef<Agent | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const transactionsRef = useRef<Transaction[] | null>(null);
  const dirtyRef = useRef(false);
  const pendingProposalRef = useRef<Transaction[] | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const editSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const result = await api.listSessions();
      setSessions(result.sessions);
      setHasMoreSessions(result.has_more);
    } catch (err) {
      showError(err);
    }
  }, []);

  const loadMoreSessions = useCallback(async () => {
    if (!hasMoreSessions || isLoadingMoreSessions) return;
    setIsLoadingMoreSessions(true);
    try {
      const result = await api.listSessions(sessions.length);
      setSessions((current) => {
        const ids = new Set(current.map((session) => session.id));
        return [...current, ...result.sessions.filter((session) => !ids.has(session.id))];
      });
      setHasMoreSessions(result.has_more);
    } catch (err) {
      showError(err);
    } finally {
      setIsLoadingMoreSessions(false);
    }
  }, [hasMoreSessions, isLoadingMoreSessions, sessions.length]);

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

  useEffect(() => {
    if (!config) return;
    if (!sessionRef.current) {
      setSelectedProvider(config.provider);
      setSelectedModel(config.model);
    }
    api.listProviderConfigs().then(async (configs) => {
      setProviderConfigs(configs);
      const discovered = await Promise.all(
        configs.map(async (providerConfig) => {
          try {
            const result = await api.listModels(undefined, providerConfig.provider);
            return result.models.map((model) => ({
              provider: providerConfig.provider,
              model,
            }));
          } catch {
            return providerConfig.model
              ? [{ provider: providerConfig.provider, model: providerConfig.model }]
              : [];
          }
        }),
      );
      setModels(discovered.flat());
    }).catch(() => {
      setProviderConfigs([config]);
      setModels(config.model ? [{ provider: config.provider, model: config.model }] : []);
    });
  }, [config]);

  const effectiveProvider =
    currentSession?.model_provider || selectedProvider || config?.provider || "";
  const effectiveConfig =
    providerConfigs.find((item) => item.provider === effectiveProvider) ||
    (config?.provider === effectiveProvider ? config : null);
  const effectiveModel =
    currentSession?.model_name || selectedModel || config?.model || "";
  const effectiveApi = (currentSession?.model_api || effectiveConfig?.api) as
    | ApiKind
    | undefined;

  // Create the unified agent when config is available. Subscribe for the
  // component lifetime so every streaming event re-renders the derived list.
  useEffect(() => {
    if (!effectiveConfig) return;
    if (!effectiveModel || !effectiveApi) return;
    const agent = createUnifiedAgent(
      { ...effectiveConfig, api: effectiveApi, model: effectiveModel },
      (txns) => {
        applyProposal(txns);
      },
    );
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
  }, [
    effectiveConfig,
    effectiveApi,
    effectiveModel,
    agentEpoch,
    bump,
  ]);

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
          !effectiveConfig?.vision &&
          !(status?.ocr_available ?? false)
        ) {
          toast.warning(
            `${t("warning.title")}: ${t("warning.image.no_reader")}`,
          );
        }
        return resolved;
      });
    },
    [effectiveConfig?.vision, status?.ocr_available],
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
      setSession(session);
      setSelectedProvider(session.model_provider || config?.provider || "");
      setSelectedModel(session.model_name);
      setAgentEpoch((value) => value + 1);
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
    const model = currentSession?.model_name || selectedModel;
    const modelApi = (currentSession?.model_api || effectiveConfig?.api) as ApiKind;
    const activeConfig =
      effectiveConfig && model
        ? { ...effectiveConfig, api: modelApi, model }
        : null;
    if ((!content && !hasFiles) || !agent || !activeConfig) return;

    const currentInput = content;
    setInput("");
    setFiles(null);

    try {
      if (!sessionRef.current) {
        const created = await api.createSession(activeConfig);
        setSession(created);
        refreshSessions();
      }
      let images: { data: string; mimeType: string }[] = [];

      let ingestTexts: string[] = [];

      if (hasFiles) {
        // Import mode: ingest files, build import prompt.
        setIsProcessing(true);
        try {
          const ingestResult = await api.ingest(
            files ?? [],
            "",
            activeConfig.vision,
          );
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
          if (!activeConfig.vision && images.length > 0) {
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
        const imageContents = images.map((image) => ({
          type: "image" as const,
          ...image,
        }));
        await agent.prompt(
          currentInput,
          imageContents.length > 0 ? imageContents : undefined,
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
      const result = await api.importConfirm(
        transactions,
        currentSession?.id,
        writePath === DEFAULT_WRITE_PATH ? undefined : writePath,
      );
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
  const availableModelChoices = Array.from(
    new Map(
      [
        ...(effectiveProvider && effectiveModel
          ? [{ provider: effectiveProvider, model: effectiveModel }]
          : []),
        ...providerConfigs
          .filter((item) => item.model)
          .map((item) => ({ provider: item.provider, model: item.model })),
        ...models,
      ].map((choice) => [modelChoiceValue(choice), choice]),
    ).values(),
  );
  const selectedModelValue =
    effectiveProvider && effectiveModel
      ? modelChoiceValue({ provider: effectiveProvider, model: effectiveModel })
      : "";

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
        hasMore={hasMoreSessions}
        isLoadingMore={isLoadingMoreSessions}
        onLoadMore={() => void loadMoreSessions()}
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
          <div className="mb-3 flex items-center gap-2 border-b pb-3">
            <span className="text-xs text-muted-foreground">
              {t("chat.model")}
            </span>
            <Select
              value={selectedModelValue}
              onValueChange={(value) => {
                const choice = parseModelChoice(value);
                setSelectedProvider(choice.provider);
                setSelectedModel(choice.model);
              }}
              disabled={Boolean(currentSession) || isProcessing || isGenerating}
            >
              <SelectTrigger
                className="h-8 w-[18rem] max-w-full"
                title={currentSession ? t("chat.model.locked") : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableModelChoices.map((choice) => (
                  <SelectItem
                    key={modelChoiceValue(choice)}
                    value={modelChoiceValue(choice)}
                  >
                    {choice.provider} / {choice.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentSession && (
              <span className="text-xs text-muted-foreground">
                {t("chat.model.locked")}
              </span>
            )}
          </div>
          <Chat
            className="min-h-0 flex-1"
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

          <div className="flex flex-wrap items-end gap-2">
            {status && status.source_files.length > 0 && (
              <div className="flex min-w-64 flex-col gap-1">
                <label className="text-xs text-muted-foreground">
                  {t("confirm.write.path")}
                </label>
                <Select value={writePath} onValueChange={setWritePath}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_WRITE_PATH}>
                      {t("confirm.write.default", {
                        path: status.default_write_path,
                      })}
                    </SelectItem>
                    {status.source_files.map((path) => (
                      <SelectItem key={path} value={path}>
                        {path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
