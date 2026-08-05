import { useEffect, useState } from "react";
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  App as AntApp,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Space,
  Switch,
  Typography,
} from "antd";

import { api, type ApiKind, type Config, type Status } from "@/api";
import { t } from "@/i18n";

function emptyConfig(bookkeepingHabits = ""): Config {
  return {
    provider: "",
    api: "openai-completions",
    base_url: "",
    model: "",
    models: [],
    api_key: "",
    api_key_stored: false,
    vision: false,
    context_window: 128_000,
    max_tokens: 16_384,
    bookkeeping_habits: bookkeepingHabits,
  };
}

function supportedModels(config: Config): string[] {
  return Array.from(
    new Set([...(config.models ?? []), config.model].filter(Boolean)),
  );
}

export function SettingsForm({
  onStatusChange,
}: {
  onStatusChange: (status: Status, close?: boolean) => void;
}) {
  const { message, modal } = AntApp.useApp();
  const [config, setConfig] = useState<Config | null>(null);
  const [storedConfigs, setStoredConfigs] = useState<Config[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    Promise.all([api.listProviderConfigs(), api.getConfig()])
      .then(([configs, activeConfig]) => {
        setStoredConfigs(configs);
        if (configs.length === 0) {
          setConfig(emptyConfig(activeConfig.bookkeeping_habits));
          setIsAdding(true);
          return;
        }
        const selected =
          configs.find((item) => item.provider === activeConfig.provider) ??
          configs[0];
        setConfig(selected);
        setAvailableModels(supportedModels(selected));
      })
      .catch(showError);
  }, []);

  function showError(error: unknown) {
    void message.error(
      t("error.generic", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  function patch(partial: Partial<Config>) {
    setConfig((current) => (current ? { ...current, ...partial } : current));
  }

  function selectProvider(provider: string) {
    const selected = storedConfigs.find((item) => item.provider === provider);
    if (!selected) return;
    setConfig(selected);
    setAvailableModels(supportedModels(selected));
    setIsAdding(false);
  }

  function startAddingProvider() {
    setConfig(emptyConfig(config?.bookkeeping_habits));
    setAvailableModels([]);
    setIsAdding(true);
  }

  function deleteProvider(provider: string) {
    modal.confirm({
      title: t("settings.provider.delete"),
      content: t("settings.provider.delete.confirm", { provider }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.deleteProviderConfig(provider);
          const configs = await api.listProviderConfigs();
          setStoredConfigs(configs);
          if (config?.provider === provider) {
            if (configs.length > 0) {
              const activeConfig = await api.getConfig();
              const selected =
                configs.find(
                  (item) => item.provider === activeConfig.provider,
                ) ?? configs[0];
              setConfig(selected);
              setAvailableModels(supportedModels(selected));
              setIsAdding(false);
            } else {
              startAddingProvider();
            }
          }
          onStatusChange(await api.status(), false);
          void message.success(t("settings.provider.deleted", { provider }));
        } catch (error) {
          showError(error);
          throw error;
        }
      },
    });
  }

  async function loadModels() {
    if (!config) return;
    setLoadingModels(true);
    try {
      const result = await api.listModels(config);
      setAvailableModels((current) =>
        Array.from(new Set([...current, ...result.models])),
      );
      void message.success(
        t("settings.models.fetched", { count: result.models.length }),
      );
    } catch (error) {
      showError(error);
    } finally {
      setLoadingModels(false);
    }
  }

  async function save() {
    if (!config) return;
    const provider = config.provider.trim();
    const models = supportedModels(config);
    if (
      isAdding &&
      storedConfigs.some((item) => item.provider === provider)
    ) {
      void message.error(t("settings.provider.duplicate", { provider }));
      return;
    }
    const nextConfig = {
      ...config,
      provider,
      models,
      model: models.includes(config.model) ? config.model : (models[0] ?? ""),
    };
    setSaving(true);
    try {
      const saved = await api.saveConfig(nextConfig);
      setConfig(saved);
      setAvailableModels(supportedModels(saved));
      setStoredConfigs((current) => {
        const index = current.findIndex(
          (item) => item.provider === saved.provider,
        );
        if (index < 0) return [...current, saved];
        return current.map((item, itemIndex) =>
          itemIndex === index ? saved : item,
        );
      });
      setIsAdding(false);
      onStatusChange(await api.status(), true);
      void message.success(t("settings.saved"));
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  }

  if (!config) return <Skeleton active paragraph={{ rows: 6 }} />;

  const selectedModels = supportedModels(config);
  const modelOptions = Array.from(
    new Set([...availableModels, ...selectedModels]),
  ).map((model) => ({ label: model, value: model }));
  const providerOptions = [...storedConfigs]
    .sort((left, right) => left.provider.localeCompare(right.provider))
    .map((item) => ({ label: item.provider, value: item.provider }));
  const maskedKey = config.api_key.includes("****");

  return (
    <Form layout="vertical" requiredMark={false} className="favai-settings-form">
      <Form.Item
        label={t("settings.provider.configured")}
        htmlFor="favai-provider-config"
      >
        <Space.Compact block>
          {isAdding ? (
            <Input
              id="favai-provider-config"
              autoFocus
              className="min-w-0 flex-1"
              value={config.provider}
              placeholder={t("settings.provider.name.placeholder")}
              onChange={(event) => patch({ provider: event.target.value })}
            />
          ) : (
            <Select
              id="favai-provider-config"
              className="min-w-0 flex-1"
              value={config.provider}
              options={providerOptions}
              onChange={selectProvider}
              optionRender={(option) => {
                const provider = String(option.data.value);
                return (
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{provider}</span>
                    <Button
                      type="text"
                      size="small"
                      danger
                      aria-label={t("settings.provider.delete.aria", {
                        provider,
                      })}
                      icon={<DeleteOutlined />}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteProvider(provider);
                      }}
                    />
                  </div>
                );
              }}
            />
          )}
          <Button
            icon={<PlusOutlined />}
            title={t("settings.provider.add")}
            aria-label={t("settings.provider.add")}
            onClick={startAddingProvider}
          />
        </Space.Compact>
      </Form.Item>

      <Form.Item label={t("settings.api")} htmlFor="favai-provider-api">
        <Select
          id="favai-provider-api"
          value={config.api}
          onChange={(api: ApiKind) => patch({ api })}
          options={[
            { label: t("settings.api.openai"), value: "openai-completions" },
            { label: t("settings.api.anthropic"), value: "anthropic-messages" },
          ]}
        />
      </Form.Item>

      <Form.Item
        label={t("settings.base_url")}
        htmlFor="favai-provider-base-url"
      >
        <Input
          id="favai-provider-base-url"
          value={config.base_url}
          onChange={(event) => patch({ base_url: event.target.value })}
        />
      </Form.Item>

      <Form.Item
        label={t("settings.models.supported")}
        htmlFor="favai-provider-models"
      >
        <Space.Compact block>
          <Select
            id="favai-provider-models"
            className="min-w-0 flex-1"
            mode="tags"
            value={selectedModels}
            placeholder={t("settings.models.placeholder")}
            options={modelOptions}
            tokenSeparators={[","]}
            onChange={(models) =>
              patch({
                models,
                model: models.includes(config.model)
                  ? config.model
                  : (models[0] ?? ""),
              })
            }
          />
          <Button
            icon={<CloudDownloadOutlined />}
            loading={loadingModels}
            onClick={() => void loadModels()}
          >
            {loadingModels
              ? t("settings.models.loading")
              : t("settings.models.fetch")}
          </Button>
        </Space.Compact>
      </Form.Item>

      <Form.Item
        label={t("settings.api_key")}
        htmlFor="favai-provider-api-key"
      >
        <Input.Password
          id="favai-provider-api-key"
          value={maskedKey ? "" : config.api_key}
          placeholder={
            maskedKey || config.api_key_stored
              ? t("settings.api_key.keep")
              : t("settings.api_key.placeholder")
          }
          onChange={(event) => patch({ api_key: event.target.value })}
        />
        <Typography.Text type="secondary" className="text-xs">
          {t("settings.api_key.placeholder")}
        </Typography.Text>
      </Form.Item>

      <Form.Item label={t("settings.vision")}>
        <Switch
          aria-label={t("settings.vision")}
          checked={config.vision}
          onChange={(vision) => patch({ vision })}
        />
      </Form.Item>

      <Form.Item
        label={t("settings.bookkeeping_habits")}
        htmlFor="favai-bookkeeping-habits"
        extra={t("settings.bookkeeping_habits.help")}
      >
        <Input.TextArea
          id="favai-bookkeeping-habits"
          value={config.bookkeeping_habits}
          placeholder={t("settings.bookkeeping_habits.placeholder")}
          autoSize={{ minRows: 3, maxRows: 8 }}
          onChange={(event) =>
            patch({ bookkeeping_habits: event.target.value })
          }
        />
      </Form.Item>

      <div className="grid grid-cols-2 gap-4">
        <Form.Item
          label={t("settings.context_window")}
          htmlFor="favai-provider-context-window"
        >
          <InputNumber
            id="favai-provider-context-window"
            min={1}
            className="w-full"
            value={config.context_window}
            onChange={(value) => patch({ context_window: value ?? 0 })}
          />
        </Form.Item>
        <Form.Item
          label={t("settings.max_tokens")}
          htmlFor="favai-provider-max-tokens"
        >
          <InputNumber
            id="favai-provider-max-tokens"
            min={1}
            className="w-full"
            value={config.max_tokens}
            onChange={(value) => patch({ max_tokens: value ?? 0 })}
          />
        </Form.Item>
      </div>

      <div className="flex justify-end">
        <Button type="primary" loading={saving} onClick={() => void save()}>
          {saving ? t("settings.saving") : t("settings.save")}
        </Button>
      </div>
    </Form>
  );
}
