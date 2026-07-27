import { useCallback, useEffect, useState } from "react";
import { SettingsIcon } from "lucide-react";

import { api, type Config, type Status } from "@/api";
import { t } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { UnifiedChat } from "@/components/UnifiedChat";
import { SettingsForm } from "@/components/SettingsTab";

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshConfig = useCallback(() => {
    api.getConfig().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    refreshConfig();
  }, [refreshConfig]);

  const onConfigSaved = useCallback(
    (newStatus: Status) => {
      setStatus(newStatus);
      refreshConfig();
      setSettingsOpen(false);
    },
    [refreshConfig],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{t("chat.title")}</h1>
          {status && (
            <Badge variant={status.configured ? "default" : "destructive"}>
              {status.configured
                ? t("settings.status.configured")
                : t("settings.status.not.configured")}
            </Badge>
          )}
        </div>
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              title={t("settings.title")}
              className={
                status && !status.configured
                  ? "border-amber-500/50 text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:border-amber-400/40 dark:text-amber-400 dark:hover:bg-amber-950"
                  : ""
              }
            >
              <SettingsIcon />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{t("settings.title")}</DialogTitle>
            </DialogHeader>
            <SettingsForm status={status} onStatusChange={onConfigSaved} />
          </DialogContent>
        </Dialog>
      </div>

      {!config && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {t("import.not.configured")}
        </div>
      )}

      {/* Main chat interface */}
      <UnifiedChat config={config} configured={status?.configured ?? false} />

      {/* Sonner renders inline (no portal), so it inherits .favai-root vars */}
      <Toaster position="top-center" />
    </div>
  );
}
