import { useCallback, useEffect, useState } from "react";
import { BookOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Space, Tag, Typography } from "antd";

import { api, type Config, type Status } from "@/api";
import { t } from "@/i18n";
import { UnifiedChat } from "@/components/UnifiedChat";
import { SettingsForm } from "@/components/SettingsTab";
import { BookkeepingHabitsForm } from "@/components/BookkeepingHabits";

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [bookkeepingHabits, setBookkeepingHabits] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [habitsOpen, setHabitsOpen] = useState(false);

  const refreshConfig = useCallback(() => {
    api.getConfig().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    api
      .getBookkeepingHabits()
      .then((result) => setBookkeepingHabits(result.bookkeeping_habits))
      .catch(() => {});
    refreshConfig();
  }, [refreshConfig]);

  const onConfigSaved = useCallback(
    (newStatus: Status, close = true) => {
      setStatus(newStatus);
      refreshConfig();
      if (close) setSettingsOpen(false);
    },
    [refreshConfig],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <Space size={8}>
          <Typography.Title level={2} style={{ margin: 0, fontSize: 20 }}>
            {t("chat.title")}
          </Typography.Title>
          {status && (
            <Tag color={status.configured ? undefined : "error"}>
              {status.configured
                ? t("settings.status.configured")
                : t("settings.status.not.configured")}
            </Tag>
          )}
        </Space>
        <Space size={8}>
          <Button
            icon={<BookOutlined />}
            title={t("bookkeeping_habits.title")}
            aria-label={t("bookkeeping_habits.title")}
            onClick={() => setHabitsOpen(true)}
          >
            {t("bookkeeping_habits.title")}
          </Button>
          <Button
            icon={<SettingOutlined />}
            title={t("settings.title")}
            aria-label={t("settings.title")}
            danger={Boolean(status && !status.configured)}
            onClick={() => setSettingsOpen(true)}
          />
        </Space>
      </div>

      {!config && (
        <Alert
          type="error"
          showIcon
          message={t("import.not.configured")}
        />
      )}

      <UnifiedChat
        config={config}
        status={status}
        bookkeepingHabits={bookkeepingHabits}
      />

      <Modal
        title={t("bookkeeping_habits.title")}
        open={habitsOpen}
        width={600}
        footer={null}
        destroyOnHidden
        onCancel={() => setHabitsOpen(false)}
      >
        <BookkeepingHabitsForm
          initialValue={bookkeepingHabits}
          onCancel={() => setHabitsOpen(false)}
          onSaved={(habits) => {
            setBookkeepingHabits(habits);
            setHabitsOpen(false);
          }}
        />
      </Modal>

      <Modal
        title={t("settings.title")}
        open={settingsOpen}
        width={600}
        footer={null}
        destroyOnHidden
        styles={{ body: { maxHeight: "calc(100vh - 160px)", overflowY: "auto" } }}
        onCancel={() => setSettingsOpen(false)}
      >
        <SettingsForm onStatusChange={onConfigSaved} />
      </Modal>
    </div>
  );
}
