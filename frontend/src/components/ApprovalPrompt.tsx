/**
 * Approval control for gated tool calls.
 *
 * This is application state rendered from the ``ApprovalManager`` — not a
 * model-generated message. It shows the exact operation (tool name and
 * canonical serialized arguments) and its expected effects before the user
 * decides. Approval can only be granted through these explicit buttons;
 * free-form chat text never reaches the approval state.
 */

import { useEffect, useState } from "react";
import { Alert, Button, Space, Typography } from "antd";
import type { ApprovalRequest } from "@/agent/approval";
import { t, type I18nKey } from "@/i18n";

export function ApprovalPrompt({
  request,
  onApprove,
  onDeny,
}: {
  request: ApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    secondsLeft(request.expiresAt),
  );

  useEffect(() => {
    setRemainingSeconds(secondsLeft(request.expiresAt));
    const timer = setInterval(() => {
      setRemainingSeconds(secondsLeft(request.expiresAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [request.expiresAt]);

  const effectKey = (request.effectKey ??
    `approval.effect.${request.policy}`) as I18nKey;

  return (
    <Alert
      type="warning"
      showIcon
      message={t("approval.title")}
      description={
        <div className="flex flex-col gap-2">
          <Typography.Text strong>
            {t("approval.operation", { tool: request.toolName })}
          </Typography.Text>
          <Typography.Text>{t(effectKey)}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            {t("approval.args")}
          </Typography.Text>
          <pre className="m-0 max-h-40 overflow-auto rounded bg-black/5 p-2 text-xs whitespace-pre-wrap">
            {request.canonicalArgs}
          </pre>
          <Typography.Text type="secondary" className="text-xs">
            {t("approval.expires", { seconds: remainingSeconds })}
          </Typography.Text>
        </div>
      }
      action={
        <Space direction="vertical">
          <Button type="primary" size="small" onClick={onApprove}>
            {t("approval.approve")}
          </Button>
          <Button danger size="small" onClick={onDeny}>
            {t("approval.deny")}
          </Button>
        </Space>
      }
    />
  );
}

function secondsLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}
