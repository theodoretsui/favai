import { useState } from "react";
import { App as AntApp, Button, Form, Input, Space } from "antd";

import { api } from "@/api";
import { t } from "@/i18n";

export function BookkeepingHabitsForm({
  initialValue,
  onSaved,
  onCancel,
}: {
  initialValue: string;
  onSaved: (habits: string) => void;
  onCancel: () => void;
}) {
  const { message } = AntApp.useApp();
  const [habits, setHabits] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const result = await api.saveBookkeepingHabits(habits);
      onSaved(result.bookkeeping_habits);
      void message.success(t("bookkeeping_habits.saved"));
    } catch (error) {
      void message.error(
        t("error.generic", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Form layout="vertical" requiredMark={false}>
      <Form.Item
        label={t("bookkeeping_habits.field")}
        htmlFor="favai-bookkeeping-habits"
        extra={t("bookkeeping_habits.help")}
      >
        <Input.TextArea
          id="favai-bookkeeping-habits"
          autoFocus
          value={habits}
          placeholder={t("bookkeeping_habits.placeholder")}
          autoSize={{ minRows: 6, maxRows: 14 }}
          onChange={(event) => setHabits(event.target.value)}
        />
      </Form.Item>
      <div className="flex justify-end">
        <Space>
          <Button onClick={onCancel}>{t("bookkeeping_habits.cancel")}</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            {saving
              ? t("bookkeeping_habits.saving")
              : t("bookkeeping_habits.save")}
          </Button>
        </Space>
      </div>
    </Form>
  );
}
