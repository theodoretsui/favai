import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  api,
  type ApiKind,
  type Config,
  type ProviderPreset,
  type Status,
} from "@/api";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/**
 * Settings form used inside the settings Dialog.
 * Loads config from the backend and lets the user edit all fields.
 */
export function SettingsForm({
  status: _status,
  onStatusChange,
}: {
  status: Status | null;
  onStatusChange: (status: Status) => void;
}) {
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
      .catch((err) =>
        toast.error(
          t("error.generic", {
            message: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
  }, []);

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
    } catch (err) {
      if (requestId !== modelRequestRef.current) return;
      if (reportError) {
        toast.error(
          t("error.generic", {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    } finally {
      if (requestId === modelRequestRef.current) {
        setLoadingModels(false);
      }
    }
  }

  function patch(partial: Partial<Config>) {
    setConfig((current) => (current ? { ...current, ...partial } : current));
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
      toast.success(t("settings.test.success"));
    } catch (err) {
      toast.error(
        t("error.generic", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  const maskedKey = config?.api_key.includes("****") ?? false;

  if (config === null) {
    return (
      <div className="py-4 text-sm text-muted-foreground">
        {t("settings.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col gap-1.5">
        <Label>{t("settings.provider")}</Label>
        <Select value={config.provider} onValueChange={selectProvider}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {provider.name}
              </SelectItem>
            ))}
            <SelectItem value="custom">
              {t("settings.provider.custom")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("settings.api")}</Label>
        <Select
          value={config.api}
          onValueChange={(value) => patch({ api: value as ApiKind })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai-completions">
              {t("settings.api.openai")}
            </SelectItem>
            <SelectItem value="anthropic-messages">
              {t("settings.api.anthropic")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("settings.base_url")}</Label>
        <Input
          value={config.base_url}
          disabled={config.provider !== "custom"}
          onChange={(e) => patch({ base_url: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("settings.model")}</Label>
        <div className="flex items-center gap-2">
          <Select
            value={config.model}
            onValueChange={(model) => patch({ model })}
          >
            <SelectTrigger className="min-w-0 flex-1">
              <SelectValue placeholder={t("settings.model.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {Array.from(
                new Set([config.model, ...models].filter(Boolean)),
              ).map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="h-8 shrink-0"
            onClick={() => void loadModels(config)}
            disabled={loadingModels}
          >
            {loadingModels
              ? t("settings.models.loading")
              : t("settings.models.fetch")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("settings.api_key")}</Label>
        <Input
          value={maskedKey ? "" : config.api_key}
          placeholder={
            maskedKey || config.api_key_stored
              ? t("settings.api_key.keep")
              : t("settings.api_key.placeholder")
          }
          onChange={(e) => patch({ api_key: e.target.value })}
          onBlur={() => {
            if (config.provider !== "custom" && config.api_key) {
              void loadModels(config, false);
            }
          }}
        />
        <span className="text-xs text-muted-foreground">
          {t("settings.api_key.placeholder")}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="favai-vision"
          checked={config.vision}
          onCheckedChange={(checked) => patch({ vision: checked })}
        />
        <Label htmlFor="favai-vision">{t("settings.vision")}</Label>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>{t("settings.context_window")}</Label>
          <Input
            type="number"
            min={1}
            value={config.context_window}
            onChange={(e) =>
              patch({ context_window: Number(e.target.value) || 0 })
            }
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>{t("settings.max_tokens")}</Label>
          <Input
            type="number"
            min={1}
            value={config.max_tokens}
            onChange={(e) =>
              patch({ max_tokens: Number(e.target.value) || 0 })
            }
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={testAndSave} disabled={saving}>
          {saving ? t("settings.test.testing") : t("settings.test.save")}
        </Button>
      </div>
    </div>
  );
}

/** @deprecated Use SettingsForm inside a Dialog instead. */
export function SettingsTab({
  status,
  onStatusChange,
}: {
  status: Status | null;
  onStatusChange: (status: Status) => void;
}) {
  return <SettingsForm status={status} onStatusChange={onStatusChange} />;
}
