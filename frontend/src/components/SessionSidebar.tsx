import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Conversations } from "@ant-design/x";
import { Button, Empty, Input, Spin } from "antd";

import type { SessionSummary } from "@/api";
import { t } from "@/i18n";

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
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const filteredSessions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? sessions.filter((session) =>
          session.title.toLocaleLowerCase().includes(query),
        )
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

  const emptyDescription =
    sessions.length === 0 ? t("history.empty") : t("history.search.empty");

  return (
    <aside className="favai-session-sidebar flex min-h-0 w-full shrink-0 flex-col gap-2 md:w-56">
      <Button
        block
        type="primary"
        icon={<PlusOutlined />}
        size="small"
        style={{ height: 32, borderRadius: 3 }}
        disabled={disabled}
        onClick={onCreate}
      >
        {t("history.new")}
      </Button>
      <Input
        allowClear
        size="small"
        prefix={<SearchOutlined />}
        aria-label={t("history.search")}
        placeholder={t("history.search")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-auto rounded-[4px] border border-solid"
      >
        {filteredSessions.length > 0 ? (
          <Conversations
            activeKey={currentId ?? undefined}
            styles={{
              root: { gap: 2, padding: 4 },
              item: { gap: 4, height: 32, minHeight: 32, paddingInline: 4 },
            }}
            items={filteredSessions.map((session) => ({
              key: session.id,
              label: session.title,
              disabled,
              icon: session.confirmed_at ? (
                <CheckCircleOutlined className="text-emerald-600" />
              ) : (
                <MessageOutlined />
              ),
            }))}
            onActiveChange={(key) => onOpen(String(key))}
            menu={(item) => ({
              items: [
                {
                  key: "rename",
                  icon: <EditOutlined />,
                  label: t("history.rename"),
                },
                {
                  key: "delete",
                  danger: true,
                  icon: <DeleteOutlined />,
                  label: t("history.delete"),
                },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                const session = sessionsById.get(String(item.key));
                if (!session) return;
                if (key === "rename") onRename(session);
                if (key === "delete") onDelete(session);
              },
            })}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
        )}
        {hasMore && (
          <div ref={loadMoreRef} className="flex h-7 items-center justify-center">
            {isLoadingMore && <Spin size="small" />}
          </div>
        )}
      </div>
    </aside>
  );
}
