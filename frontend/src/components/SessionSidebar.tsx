import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";

import type { SessionSummary } from "@/api";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function SessionSidebar({
  sessions,
  currentId,
  disabled,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: {
  sessions: SessionSummary[];
  currentId: string | null;
  disabled: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onRename: (session: SessionSummary) => void;
  onDelete: (session: SessionSummary) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const filteredSessions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? sessions.filter((session) => session.title.toLocaleLowerCase().includes(query))
      : sessions;
  }, [search, sessions]);

  useEffect(() => {
    const root = listRef.current;
    const target = loadMoreRef.current;
    if (!root || !target || !hasMore || isLoadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore();
      },
      { root, rootMargin: "120px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredSessions.length, hasMore, isLoadingMore, onLoadMore]);

  return (
    <TooltipProvider>
      <aside className="flex min-h-0 w-full shrink-0 flex-col gap-2 rounded-xl border p-2 md:w-56">
        <Button variant="outline" size="sm" onClick={onCreate} disabled={disabled}>
          <PlusIcon />
          {t("history.new")}
        </Button>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("history.search")}
            className="h-7 pl-8 text-xs placeholder:text-left"
            placeholder={t("history.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div
          ref={listRef}
          className="flex min-h-0 gap-1 overflow-x-auto md:flex-col md:overflow-y-auto"
        >
          {sessions.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              {t("history.empty")}
            </div>
          )}
          {sessions.length > 0 && filteredSessions.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              {t("history.search.empty")}
            </div>
          )}
          {filteredSessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                "group flex min-w-44 items-center gap-1 rounded-lg p-1 md:min-w-0",
                currentId === session.id && "bg-muted",
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs"
                    onClick={() => onOpen(session.id)}
                    disabled={disabled}
                  >
                    {session.confirmed_at ? (
                      <CheckIcon className="size-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{session.title}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>{session.title}</TooltipContent>
              </Tooltip>
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
          {hasMore && <div ref={loadMoreRef} className="h-px shrink-0" />}
        </div>
      </aside>
    </TooltipProvider>
  );
}
