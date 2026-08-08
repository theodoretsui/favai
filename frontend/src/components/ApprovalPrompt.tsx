/**
 * Approval control for gated tool calls, embedded in the composer.
 *
 * This is application state rendered from the ``ApprovalManager`` — not a
 * model-generated message. It shows the exact operation (tool name and
 * serialized arguments) and its expected effects before the user decides.
 * Approval can only be granted through these explicit buttons; free-form
 * chat text never reaches the approval state.
 *
 * The bar is rendered inside the ``Sender`` header so it reads as part of
 * the input box, like mainstream agent composers: the pending operation is
 * summarized inline, arguments are shown as a readable form with a
 * per-field label, and the approve/deny buttons sit next to the input area.
 */

import { useEffect, useState } from "react";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import { Button, Typography } from "antd";
import type { ApprovalRequest } from "@/agent/approval";
import { t, type I18nKey } from "@/i18n";

/** Field labels for known tool arguments. */
const ARG_LABELS: Partial<Record<string, I18nKey>> = {
  path: "approval.field.path",
  initial_content: "approval.field.initial_content",
  include_in_main: "approval.field.include_in_main",
};

/** Render a scalar argument value for human review. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) {
    return t("approval.empty");
  }
  if (typeof value === "boolean") {
    return value ? t("approval.yes") : t("approval.no");
  }
  if (typeof value === "string") {
    return value.length === 0 ? t("approval.empty") : value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Present arguments as a form (field label + value rows). Falls back to a
 * JSON dump for non-object shapes so the full payload is never hidden.
 */
function ArgsForm({ args }: { args: unknown }) {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return (
      <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/5 p-2 text-xs whitespace-pre-wrap">
        {JSON.stringify(args, null, 2)}
      </pre>
    );
  }
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) {
    return (
      <Typography.Text type="secondary" className="text-xs">
        {t("approval.empty")}
      </Typography.Text>
    );
  }
  return (
    <div className="mt-1 flex flex-col gap-1">
      {entries.map(([key, value]) => {
        const label = ARG_LABELS[key as keyof typeof ARG_LABELS];
        return (
          <div key={key} className="flex items-baseline gap-2 text-xs">
            <span className="w-28 shrink-0 text-secondary-foreground">
              {label ? t(label) : key}
            </span>
            <span className="min-w-0 break-words text-foreground">
              {renderValue(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

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
    <div className="favai-approval-inline flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
      <SafetyCertificateOutlined
        aria-hidden
        className="mt-0.5 shrink-0 text-primary"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Typography.Text strong className="text-sm">
            {t("approval.operation", { tool: request.toolName })}
          </Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            {t("approval.expires", { seconds: remainingSeconds })}
          </Typography.Text>
        </div>
        <Typography.Text type="secondary" className="block text-xs">
          {t(effectKey)}
        </Typography.Text>
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-secondary select-none">
            {t("approval.args")}
          </summary>
          <ArgsForm args={request.args} />
        </details>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="small" danger onClick={onDeny}>
          {t("approval.deny")}
        </Button>
        <Button size="small" type="primary" onClick={onApprove}>
          {t("approval.approve")}
        </Button>
      </div>
    </div>
  );
}

function secondsLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}