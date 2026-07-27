import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api, type ApiKind, type Config, type Status } from "@/api";
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((err) =>
        toast.error(
          t("error.generic", {
            message: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
  }, []);

  function patch(partial: Partial<Config>) {
    setConfig((current) => (current ? { ...current, ...partial } : current));
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const saved = await api.saveConfig(config);
      setConfig(saved);
      onStatusChange(await api.status());
      toast.success(t("settings.saved"));
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
          onChange={(e) => patch({ base_url: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("settings.model")}</Label>
        <Input
          value={config.model}
          onChange={(e) => patch({ model: e.target.value })}
        />
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
        <Button onClick={save} disabled={saving}>
          {t("settings.save")}
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
