"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { NotificationListItem } from "@/lib/notifications/queries";

type Props = {
  userRole: "admin" | "staff";
};

function getHref(
  item: NotificationListItem,
  role: "admin" | "staff",
): string | null {
  if (!item.related_entity_type || !item.related_entity_id) return null;
  switch (item.related_entity_type) {
    case "customer":
      return `/customers/${item.related_entity_id}`;
    case "approval":
      return "/approvals";
    case "backup_job":
    case "backup":
      return role === "admin" ? "/admin/backups" : null;
    default:
      return null;
  }
}

export function NotificationsClient({ userRole }: Props) {
  const [items, setItems] = useState<NotificationListItem[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadUnreadCount = useCallback(async () => {
    const res = await fetch("/api/notifications/unread-count");
    if (res.ok) {
      const data = (await res.json()) as { unreadCount?: number };
      setUnreadCount(data.unreadCount ?? 0);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({
      unreadOnly: String(unreadOnly),
      limit: "50",
    });
    const res = await fetch(`/api/notifications?${qs}`);
    const data = (await res.json()) as {
      items?: NotificationListItem[];
      error?: string;
    };
    if (!res.ok) {
      setMessage(data.error ?? "加载失败");
      setLoading(false);
      return;
    }
    setItems(data.items ?? []);
    setLoading(false);
    await loadUnreadCount();
  }, [unreadOnly, loadUnreadCount]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    const res = await fetch(`/api/notifications/${id}/read`, {
      method: "PATCH",
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setMessage(data.error ?? "标记失败");
      return;
    }
    await load();
  }

  async function markAllRead() {
    const res = await fetch("/api/notifications/read-all", { method: "PATCH" });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setMessage(data.error ?? "操作失败");
      return;
    }
    setMessage("已全部标记为已读");
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">
          未读通知：<span className="font-semibold text-slate-900">{unreadCount}</span>
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          只看未读
        </label>
        <Button type="button" variant="secondary" onClick={() => void markAllRead()}>
          全部标记已读
        </Button>
        {message && <p className="text-sm text-slate-600">{message}</p>}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">暂无通知</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const href = getHref(item, userRole);
            const row = (
              <div
                className={
                  item.is_read
                    ? "rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    : "rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm"
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{item.title}</p>
                    <p className="mt-1 text-sm text-slate-700">{item.message}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {item.created_at.slice(0, 16).replace("T", " ")}
                      {!item.is_read && (
                        <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700">
                          未读
                        </span>
                      )}
                    </p>
                  </div>
                  {!item.is_read && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0 text-xs"
                      onClick={(e) => {
                        e.preventDefault();
                        void markRead(item.id);
                      }}
                    >
                      标为已读
                    </Button>
                  )}
                </div>
              </div>
            );

            return (
              <li key={item.id}>
                {href ? (
                  <Link
                    href={href}
                    className="block"
                    onClick={() => {
                      if (!item.is_read) void markRead(item.id);
                    }}
                  >
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
