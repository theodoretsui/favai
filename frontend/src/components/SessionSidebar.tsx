import { CheckIcon, MessageSquareIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import type { SessionSummary } from "@/api";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SessionSidebar({
  sessions,
  currentId,
  disabled,
  onCreate,
  onOpen,
  onRename,
  onDelete,
}: {
  sessions: SessionSummary[];
  currentId: string | null;
  disabled: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onRename: (session: SessionSummary) => void;
  onDelete: (session: SessionSummary) => void;
}) {
  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col gap-2 rounded-xl border p-2 md:w-56">
      <Button variant="outline" size="sm" onClick={onCreate} disabled={disabled}>
        <PlusIcon />
        {t("history.new")}
      </Button>
      <div className="flex min-h-0 gap-1 overflow-x-auto md:flex-col md:overflow-y-auto">
        {sessions.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("history.empty")}
          </div>
        )}
        {sessions.map((session) => (
          <div
            key={session.id}
            className={cn(
              "group flex min-w-44 items-center gap-1 rounded-lg p-1 md:min-w-0",
              currentId === session.id && "bg-muted",
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs"
              onClick={() => onOpen(session.id)}
              disabled={disabled}
              title={session.title}
            >
              {session.confirmed_at ? (
                <CheckIcon className="size-3.5 shrink-0 text-emerald-600" />
              ) : (
                <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{session.title}</span>
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-60 group-hover:opacity-100"
              title={t("history.rename")}
              onClick={() => onRename(session)}
              disabled={disabled}
            >
              <PencilIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-60 group-hover:opacity-100"
              title={t("history.delete")}
              onClick={() => onDelete(session)}
              disabled={disabled}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
      </div>
    </aside>
  );
}
