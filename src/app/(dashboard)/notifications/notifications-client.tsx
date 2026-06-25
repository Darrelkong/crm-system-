"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import {
  resolveNotificationMessage,
  resolveNotificationTitle,
} from "@/i18n/resolve-notification-content";
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

function getActionLabel(
  t: (key: string) => string,
  item: NotificationListItem,
  role: "admin" | "staff",
): string | null {
  const href = getHref(item, role);
  if (!href) return null;
  if (item.related_entity_type === "customer") {
    return t("notifications.viewRelatedClient");
  }
  if (item.related_entity_type === "approval") {
    return t("notifications.viewApproval");
  }
  return t("notifications.viewDetails");
}

function formatCreatedAt(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "—";
  return value.slice(0, 16).replace("T", " ");
}

function safeResolveTitle(
  t: ReturnType<typeof useTranslation>["t"],
  item: NotificationListItem,
): string {
  try {
    return resolveNotificationTitle(t, item) || "—";
  } catch {
    return item.title ?? "—";
  }
}

function safeResolveMessage(
  t: ReturnType<typeof useTranslation>["t"],
  item: NotificationListItem,
): string {
  try {
    return resolveNotificationMessage(t, item) || "";
  } catch {
    return item.message ?? "";
  }
}

export function NotificationsClient({ userRole }: Props) {
  const { t } = useTranslation();
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
      errorCode?: string;
      code?: string;
    };
    if (!res.ok) {
      setMessage(resolveApiError(t, data));
      setLoading(false);
      return;
    }
    setItems(data.items ?? []);
    setLoading(false);
    await loadUnreadCount();
  }, [unreadOnly, loadUnreadCount, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    const res = await fetch(`/api/notifications/${id}/read`, {
      method: "PATCH",
    });
    if (!res.ok) {
      const data = (await res.json()) as {
        error?: string;
        errorCode?: string;
        code?: string;
      };
      setMessage(resolveApiError(t, data));
      return;
    }
    await load();
  }

  async function markAllRead() {
    const res = await fetch("/api/notifications/read-all", { method: "PATCH" });
    if (!res.ok) {
      const data = (await res.json()) as {
        error?: string;
        errorCode?: string;
        code?: string;
      };
      setMessage(resolveApiError(t, data));
      return;
    }
    setMessage(t("notifications.markAllSuccess"));
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">
          {t("notifications.unreadCount", { count: String(unreadCount) })}
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          {t("notifications.unreadOnly")}
        </label>
        <Button type="button" variant="secondary" onClick={() => void markAllRead()}>
          {t("notifications.markAllAsRead")}
        </Button>
        {message && <p className="text-sm text-slate-600">{message}</p>}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">{t("notifications.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">
          {unreadOnly
            ? t("notifications.noUnreadNotifications")
            : t("notifications.noNotifications")}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const href = getHref(item, userRole);
            const actionLabel = getActionLabel(t, item, userRole);
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
                    <p className="text-xs text-slate-500">
                      {t("notifications.notificationType")}: {item.type}
                    </p>
                    <p className="mt-1 font-medium text-slate-900">
                      {safeResolveTitle(t, item)}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {safeResolveMessage(t, item)}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {t("notifications.notificationTime")}:{" "}
                      {formatCreatedAt(item.created_at)}
                      {!item.is_read && (
                        <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700">
                          {t("notifications.unread")}
                        </span>
                      )}
                    </p>
                    {actionLabel && href && (
                      <p className="mt-2 text-xs text-indigo-600">{actionLabel}</p>
                    )}
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
                      {t("notifications.markAsRead")}
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
