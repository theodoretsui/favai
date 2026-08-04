import { useEffect, useRef, useState } from "react";
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

import {
  api,
  type ApiKind,
  type Config,
  type ProviderPreset,
  type Status,
} from "@/api";
import { t } from "@/i18n";

export function SettingsForm({
  onStatusChange,
}: {
  onStatusChange: (status: Status) => void;
}) {
  const { message } = AntApp.useApp();
  const [config, setConfig] = useState<Config | null>(null);
  const [providers, setProviders] = useState<ProviderPreset[]>([]);
  const [storedConfigs, setStoredConfigs] = useState<Config[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const modelRequestRef = useRef(0);

  useEffect(() => {
    api.listProviders().then(setProviders).catch(() => {});
    api.listProviderConfigs().then(setStoredConfigs).catch(() => {});
    api
      .getConfig()
      .then((savedConfig) => {
        setConfig(savedConfig);
        if (savedConfig.provider !== "custom") {
          void loadModels(savedConfig, false);
        }
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

  function selectProvider(providerId: string) {
    const stored = storedConfigs.find((item) => item.provider === providerId);
    if (stored) {
      setConfig(stored);
      setModels([]);
      void loadModels(stored, false);
      return;
    }
    const preset = providers.find((item) => item.id === providerId);
    if (!preset) {
      patch({ provider: "custom" });
      return;
    }
    const nextConfig: Config = {
      ...config!,
      provider: preset.id,
      api: preset.api,
      base_url: preset.base_url,
      model: preset.model,
      vision: preset.vision,
      api_key: "",
      api_key_stored: false,
    };
    setConfig(nextConfig);
    setModels([]);
    void loadModels(nextConfig, false);
  }

  async function loadModels(
    targetConfig: Config | null = config,
    reportError = true,
  ) {
    if (!targetConfig) return;
    const requestId = ++modelRequestRef.current;
    setLoadingModels(true);
    try {
      const result = await api.listModels(targetConfig);
      if (requestId !== modelRequestRef.current) return;
      setModels(result.models);
      if (!targetConfig.model && result.models.length > 0) {
        patch({ model: result.models[0] });
      }
    } catch (error) {
      if (requestId === modelRequestRef.current && reportError) showError(error);
    } finally {
      if (requestId === modelRequestRef.current) setLoadingModels(false);
    }
  }

  async function testAndSave() {
    if (!config) return;
    setSaving(true);
    try {
      const result = await api.testConfig(config);
      setConfig(result.config);
      setModels(result.models);
      setStoredConfigs((current) => [
        ...current.filter((item) => item.provider !== result.config.provider),
        result.config,
      ]);
      onStatusChange(await api.status());
      void message.success(t("settings.test.success"));
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  }

  if (!config) return <Skeleton active paragraph={{ rows: 6 }} />;

  const maskedKey = config.api_key.includes("****");
  const modelOptions = Array.from(
    new Set([config.model, ...models].filter(Boolean)),
  ).map((model) => ({ label: model, value: model }));

  return (
    <Form layout="vertical" requiredMark={false} className="favai-settings-form">
      <Form.Item label={t("settings.provider")}>
        <Select
          value={config.provider}
          onChange={selectProvider}
          options={[
            ...providers.map((provider) => ({
              label: provider.name,
              value: provider.id,
            })),
            { label: t("settings.provider.custom"), value: "custom" },
          ]}
        />
      </Form.Item>

      <Form.Item label={t("settings.api")}>
        <Select
          value={config.api}
          onChange={(api: ApiKind) => patch({ api })}
          options={[
            { label: t("settings.api.openai"), value: "openai-completions" },
            { label: t("settings.api.anthropic"), value: "anthropic-messages" },
          ]}
        />
      </Form.Item>

      <Form.Item label={t("settings.base_url")}>
        <Input
          value={config.base_url}
          disabled={config.provider !== "custom"}
          onChange={(event) => patch({ base_url: event.target.value })}
        />
      </Form.Item>

      <Form.Item label={t("settings.model")}>
        <Space.Compact block>
          <Select
            className="min-w-0 flex-1"
            value={config.model || undefined}
            placeholder={t("settings.model.placeholder")}
            loading={loadingModels}
            showSearch
            options={modelOptions}
            onChange={(model) => patch({ model })}
          />
          <Button onClick={() => void loadModels(config)} loading={loadingModels}>
            {loadingModels
              ? t("settings.models.loading")
              : t("settings.models.fetch")}
          </Button>
        </Space.Compact>
      </Form.Item>

      <Form.Item label={t("settings.api_key")}>
        <Input.Password
          value={maskedKey ? "" : config.api_key}
          placeholder={
            maskedKey || config.api_key_stored
              ? t("settings.api_key.keep")
              : t("settings.api_key.placeholder")
          }
          onChange={(event) => patch({ api_key: event.target.value })}
          onBlur={() => {
            if (config.provider !== "custom" && config.api_key) {
              void loadModels(config, false);
            }
          }}
        />
        <Typography.Text type="secondary" className="text-xs">
          {t("settings.api_key.placeholder")}
        </Typography.Text>
      </Form.Item>

      <Form.Item label={t("settings.vision")}>
        <Switch
          checked={config.vision}
          onChange={(vision) => patch({ vision })}
        />
      </Form.Item>

      <div className="grid grid-cols-2 gap-4">
        <Form.Item label={t("settings.context_window")}>
          <InputNumber
            min={1}
            className="w-full"
            value={config.context_window}
            onChange={(value) => patch({ context_window: value ?? 0 })}
          />
        </Form.Item>
        <Form.Item label={t("settings.max_tokens")}>
          <InputNumber
            min={1}
            className="w-full"
            value={config.max_tokens}
            onChange={(value) => patch({ max_tokens: value ?? 0 })}
          />
        </Form.Item>
      </div>

      <div className="flex justify-end">
        <Button type="primary" loading={saving} onClick={() => void testAndSave()}>
          {saving ? t("settings.test.testing") : t("settings.test.save")}
        </Button>
      </div>
    </Form>
  );
}
