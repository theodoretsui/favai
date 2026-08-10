import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";

import {
  api,
  type ApiKind,
  type ChangeSetPreview,
  type Config,
  type Session,
  type SessionSummary,
  type Status,
  type Transaction,
} from "@/api";
import { t } from "@/i18n";
import { getLedgerData } from "@/agent/favaApi";
import {
  buildImportPrompt,
  UNIFIED_SYSTEM_PROMPT,
  withBookkeepingHabits,
} from "@/agent/prompts";
import { createUnifiedAgent } from "@/agent/factory";
import { ApprovalManager } from "@/agent/approval";
import {
  ingestContentBlock,
  toChatMessages,
} from "@/agent/toChatMessages";
import { Chat } from "@/components/Chat";
import { SessionSidebar } from "@/components/SessionSidebar";
import { ImportedTransactions } from "@/components/ImportedTransactions";
import { ProposalTable } from "@/components/ProposalTable";
import { prepareTransactionsForValidation } from "@/components/proposalEditing";
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
  bookkeepingHabits,
}: {
  config: Config | null;
  status: Status | null;
  bookkeepingHabits: string;
}) {
  const { message, modal } = AntApp.useApp();
  // Re-render trigger: bumped on every agent event so the derived message list
  // reflects the latest ``agent.state``. The agent transcript is the single
  // source of truth -- we no longer mirror it into local state.
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const [isProcessing, setIsProcessing] = useState(false);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[] | null>(null);
  const [changeSet, setChangeSet] = useState<ChangeSetPreview | null>(null);
  const [proposalDraft, setProposalDraft] = useState<Transaction[]>([]);
  const [proposalDirty, setProposalDirty] = useState(false);
  const [isValidatingProposal, setIsValidatingProposal] = useState(false);
  const [writePath, setWritePath] = useState(DEFAULT_WRITE_PATH);
  const [providerConfigs, setProviderConfigs] = useState<Config[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [agentEpoch, setAgentEpoch] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const agentRef = useRef<Agent | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const changeSetRef = useRef<ChangeSetPreview | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  // Human-in-the-loop approval state. In-memory application state only —
  // never persisted into conversation history, and disposed with the
  // component so pending approvals fail closed on teardown.
  const approvalManagerRef = useRef<ApprovalManager | null>(null);
  if (!approvalManagerRef.current) {
    approvalManagerRef.current = new ApprovalManager();
  }
  const approvalManager = approvalManagerRef.current;
  useEffect(() => approvalManager.subscribe(bump), [approvalManager, bump]);
  useEffect(() => () => approvalManager.dispose(), [approvalManager]);

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

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!config) return;
    if (!sessionRef.current) {
      setSelectedProvider(config.provider);
      setSelectedModel(config.model);
    }
    api.listProviderConfigs().then((configs) => {
      setProviderConfigs(configs);
    }).catch(() => {
      setProviderConfigs([config]);
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
      bookkeepingHabits,
      (changeSet) => {
        applyProposal(changeSet);
      },
      () => sessionRef.current?.id ?? undefined,
      {
        manager: approvalManager,
        getLedgerId: () => getLedgerData().baseUrl,
        getSessionId: () => sessionRef.current?.id ?? undefined,
      },
    );
    if (sessionRef.current) {
      agent.state.messages = sessionRef.current.messages as AgentMessage[];
    }
    agentRef.current = agent;
    const unsub = agent.subscribe(bump);
    // Ref updates do not render on their own. Render once after restoring a
    // session transcript so the first history click displays its messages.
    bump();
    return () => {
      unsub();
      agent.abort();
      agentRef.current = null;
    };
  }, [
    effectiveConfig,
    effectiveApi,
    effectiveModel,
    bookkeepingHabits,
    agentEpoch,
    bump,
  ]);

  const showError = useCallback((err: unknown) => {
    void message.error(
      t("error.generic", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }, [message]);

  function setSession(session: Session | null) {
    sessionRef.current = session;
    setCurrentSession(session);
  }

  function replaceChangeSet(value: ChangeSetPreview | null) {
    changeSetRef.current = value;
    setChangeSet(value);
    setProposalDraft(value?.transactions ?? []);
    setProposalDirty(false);
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
        proposal: null,
        proposal_dirty: false,
        pending_proposal: null,
      });
      setSession(saved);
      await refreshSessions();
    }).catch((err: unknown) => {
      showError(err);
    });
    return saveChainRef.current;
  }

  function applyProposal(changeSet: ChangeSetPreview | null) {
    if (!changeSet) return;
    replaceChangeSet(changeSet);
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
          void message.warning(
            `${t("warning.title")}: ${t("warning.image.no_reader")}`,
          );
        }
        return resolved;
      });
    },
    [effectiveConfig?.vision, message, status?.ocr_available],
  );

  function resetSession() {
    agentRef.current?.reset();
    setSession(null);
    replaceChangeSet(null);
    setFiles(null);
    bump();
  }

  async function openSession(sessionId: string) {
    if (isProcessing || agentRef.current?.state.isStreaming) return;
    try {
      const session = await api.getSession(sessionId);
      setSession(session);
      setSelectedProvider(session.model_provider || config?.provider || "");
      setSelectedModel(session.model_name);
      setAgentEpoch((value) => value + 1);
      setFiles(null);
      // Restore the pending change set from the backend (in-memory per
      // ledger/session); legacy sessions without one start clean.
      try {
        const proposal = await api.getProposal(sessionId);
        replaceChangeSet(proposal);
      } catch {
        replaceChangeSet(null);
      }
      bump();
    } catch (err) {
      showError(err);
    }
  }

  async function newSession() {
    if (isProcessing || agentRef.current?.state.isStreaming) return;
    resetSession();
  }

  function renameHistory(session: SessionSummary) {
    let title = session.title;
    modal.confirm({
      title: t("history.rename"),
      content: (
        <Input
          autoFocus
          defaultValue={session.title}
          onChange={(event) => { title = event.target.value; }}
        />
      ),
      onOk: async () => {
        const nextTitle = title.trim();
        if (!nextTitle || nextTitle === session.title) return;
        try {
          const renamed = await api.renameSession(session.id, nextTitle);
          if (sessionRef.current?.id === renamed.id) setSession(renamed);
          await refreshSessions();
        } catch (err) {
          showError(err);
          throw err;
        }
      },
    });
  }

  function deleteHistory(session: SessionSummary) {
    modal.confirm({
      title: t("history.delete"),
      content: t("history.delete.confirm"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.deleteSession(session.id);
          if (sessionRef.current?.id === session.id) resetSession();
          await refreshSessions();
        } catch (err) {
          showError(err);
          throw err;
        }
      },
    });
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
            void message.warning(`${t("warning.title")}: ${warning}`);
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
          agent.state.systemPrompt = `${withBookkeepingHabits(
            UNIFIED_SYSTEM_PROMPT,
            bookkeepingHabits,
          )}\n\n${importContext}`;
          ingestTexts = ingestResult.texts;

          images = ingestResult.images;
          if (!activeConfig.vision && images.length > 0) {
            void message.warning(
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
        agent.state.systemPrompt = withBookkeepingHabits(
          UNIFIED_SYSTEM_PROMPT,
          bookkeepingHabits,
        );
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

  function handleInputChange(value: string) {
    setInput(value);
  }

  function abort() {
    agentRef.current?.abort();
  }

  async function confirm() {
    const current = changeSetRef.current;
    const sessionId = currentSession?.id;
    if (!current || !sessionId) return;
    try {
      const result = await api.proposalConfirm(
        sessionId,
        current.revision,
        writePath === DEFAULT_WRITE_PATH ? undefined : writePath,
      );
      void message.success(t("confirm.success", { count: result.inserted }));
      replaceChangeSet(null);
      if (currentSession) {
        const session = await api.getSession(sessionId);
        setSession(session);
      }
      await refreshSessions();
    } catch (err) {
      showError(err);
    }
  }

  async function validateProposalEdits() {
    const sessionId = currentSession?.id;
    if (!changeSet || !sessionId || !proposalDirty) return;
    setIsValidatingProposal(true);
    try {
      const updated = await api.proposalPreview(
        "transactions",
        { transactions: prepareTransactionsForValidation(proposalDraft) },
        sessionId,
        writePath === DEFAULT_WRITE_PATH ? undefined : writePath,
      );
      replaceChangeSet(updated);
      void message.success(t("proposal.edit.validated"));
    } catch (err) {
      showError(err);
    } finally {
      setIsValidatingProposal(false);
    }
  }

  async function discard() {
    resetSession();
    void message.success(t("discard.done"));
  }

  // ── Derive Chat messages from agent state ──────────────────────────────

  const agent = agentRef.current;
  const chatMessages = agent
    ? toChatMessages(agent.state.messages, agent.state.streamingMessage)
    : [];
  const isGenerating = agent?.state.isStreaming ?? false;
  const pendingApproval = approvalManager.current;

  // ── Render ──────────────────────────────────────────────────────────────

  const isConfigured = status?.configured ?? false;
  const availableModelChoices = Array.from(
    new Map(
      [
        ...providerConfigs.flatMap((item) =>
          (item.models.length > 0 ? item.models : [item.model])
            .filter(Boolean)
            .map((model) => ({ provider: item.provider, model })),
        ),
        ...(effectiveProvider && effectiveModel
          ? [{ provider: effectiveProvider, model: effectiveModel }]
          : []),
      ].map((choice) => [modelChoiceValue(choice), choice]),
    ).values(),
  );
  const choicesByProvider = new Map<string, ModelChoice[]>();
  for (const choice of availableModelChoices) {
    const providerChoices = choicesByProvider.get(choice.provider) ?? [];
    providerChoices.push(choice);
    choicesByProvider.set(choice.provider, providerChoices);
  }
  const modelOptionGroups = Array.from(
    choicesByProvider,
    ([provider, choices]) => ({
      label: provider,
      title: provider,
      options: choices.map((choice) => ({
        value: modelChoiceValue(choice),
        label: choice.model,
      })),
    }),
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
        {!isConfigured && (
          <Alert
            type="warning"
            showIcon
            message={t("unified.callout.not_configured")}
          />
        )}

        <Card
          size="small"
          className="favai-chat-card flex h-[32rem] max-h-[calc(100vh-12rem)] flex-col overflow-hidden"
          styles={{
            body: {
              display: "flex",
              flex: "1 1 0",
              minHeight: 0,
              flexDirection: "column",
            },
          }}
          title={
            <Space size={8} wrap>
              <label htmlFor="favai-model-select" className="text-xs">
                {t("chat.model")}
              </label>
              <Select
                id="favai-model-select"
                value={selectedModelValue || undefined}
                className="w-72 max-w-full"
                title={currentSession ? t("chat.model.locked") : undefined}
                disabled={Boolean(currentSession) || isProcessing || isGenerating}
                options={modelOptionGroups}
                onChange={(value) => {
                  const choice = parseModelChoice(value);
                  setSelectedProvider(choice.provider);
                  setSelectedModel(choice.model);
                }}
              />
              {currentSession && (
                <Typography.Text type="secondary" className="text-xs">
                  {t("chat.model.locked")}
                </Typography.Text>
              )}
            </Space>
          }
        >
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
            approval={pendingApproval}
            onApprove={
              pendingApproval
                ? () => approvalManager.approve(pendingApproval.id)
                : undefined
            }
            onDeny={
              pendingApproval
                ? () => approvalManager.deny(pendingApproval.id)
                : undefined
            }
          />
        </Card>

        {changeSet && (
          <Card
            size="small"
            title={
              <Space>
                <span>{t("proposal.title")}</span>
                <Tag>{t("proposal.change_set.revision", { revision: changeSet.revision })}</Tag>
              </Space>
            }
          >
            <div className="flex flex-col gap-3">
              <Alert
                type="info"
                showIcon
                message={t("proposal.change_set.summary", {
                  directives: changeSet.directive_count,
                  transactions: changeSet.transaction_count,
                })}
              />
              {proposalDraft.length > 0 && (
                <ProposalTable
                  transactions={proposalDraft}
                  accounts={getLedgerData().accounts}
                  onChange={(transactions) => {
                    setProposalDraft(transactions);
                    setProposalDirty(true);
                  }}
                />
              )}
              {changeSet.preview ? (
                <pre className="m-0 max-h-96 overflow-auto rounded bg-black/5 p-3 text-xs whitespace-pre-wrap">
                  {changeSet.preview}
                </pre>
              ) : (
                <Empty description={t("proposal.empty")} />
              )}

              <Space wrap align="end">
                {proposalDirty && (
                  <Tag color="warning">{t("proposal.edit.unsaved")}</Tag>
                )}
                {status && status.source_files.length > 0 && (
                  <Form.Item
                    label={t("confirm.write.path")}
                    style={{ marginBottom: 0, minWidth: 256 }}
                  >
                    <Select
                      value={writePath}
                      onChange={setWritePath}
                      options={[
                        {
                          value: DEFAULT_WRITE_PATH,
                          label: t("confirm.write.default", {
                            path: status.default_write_path,
                          }),
                        },
                        ...status.source_files.map((path) => ({
                          value: path,
                          label: path,
                        })),
                      ]}
                    />
                  </Form.Item>
                )}
                <Button
                  onClick={() => void validateProposalEdits()}
                  disabled={
                    !proposalDirty || isGenerating || isValidatingProposal
                  }
                  loading={isValidatingProposal}
                >
                  {t("proposal.edit.validate")}
                </Button>
                <Button
                  type="primary"
                  onClick={() => void confirm()}
                  disabled={
                    isGenerating ||
                    !currentSession ||
                    proposalDirty ||
                    isValidatingProposal
                  }
                >
                  {t("confirm.submit")}
                </Button>
                <Button onClick={() => void discard()} disabled={isGenerating}>
                  {t("discard.submit")}
                </Button>
              </Space>
            </div>
          </Card>
        )}

        {/* Confirmed imports are immutable history below the active proposal. */}
        {currentSession && currentSession.confirmed_transactions.length > 0 && (
          <ImportedTransactions
            transactions={currentSession.confirmed_transactions}
            confirmedCount={currentSession.confirmed_count}
          />
        )}
      </div>
    </div>
  );
}
