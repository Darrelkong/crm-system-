"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import {
  resolveNotificationMessage,
  resolveNotificationTitle,
} from "@/i18n/resolve-notification-content";
import {
  getNotificationCategory,
  getNotificationTypeLabelKey,
} from "@/lib/notifications/category";
import type { NotificationListItem } from "@/lib/notifications/queries";
import { formatHongKongDateTime } from "@/lib/timezone";

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
  return formatHongKongDateTime(value);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        if (a.is_read !== b.is_read) {
          return a.is_read ? 1 : -1;
        }
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }),
    [items],
  );

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
      <div className="surface-card flex flex-wrap items-center gap-3 p-4">
        <p className="text-sm text-[#6B7890]">
          {t("notifications.unreadCount", { count: String(unreadCount) })}
        </p>
        <label className="flex items-center gap-2 text-sm text-[#172033]">
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
        {message && <p className="text-sm text-[#6B7890]">{message}</p>}
      </div>

      {loading ? (
        <p className="text-sm text-[#6B7890]">{t("notifications.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[#6B7890]">
          {unreadOnly
            ? t("notifications.noUnreadNotifications")
            : t("notifications.noNotifications")}
        </p>
      ) : (
        <ul className="space-y-3">
          {sortedItems.map((item) => {
            const href = getHref(item, userRole);
            const actionLabel = getActionLabel(t, item, userRole);
            const category = getNotificationCategory(item.type);
            const typeKey = getNotificationTypeLabelKey(item.type);
            const typeLabel =
              t(typeKey) === typeKey ? item.type : t(typeKey);
            const row = (
              <div
                className={cn(
                  "surface-card p-4 sm:p-5",
                  !item.is_read
                    ? "border-[#C5DAF0] bg-[#F7FAFD]"
                    : "border-[#EEF3F8] bg-[#FAFBFD] opacity-90",
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="accent">
                        {t(`notificationCategories.${category}`)}
                      </Badge>
                      <span className="text-xs text-[#6B7890]">{typeLabel}</span>
                      {!item.is_read && (
                        <Badge variant="accent">{t("notifications.unread")}</Badge>
                      )}
                    </div>
                    <p className="mt-2 font-medium text-[#172033]">
                      {safeResolveTitle(t, item)}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-[#3D4A5C]">
                      {safeResolveMessage(t, item)}
                    </p>
                    <p className="mt-2 text-xs text-[#6B7890]">
                      {formatCreatedAt(item.created_at)}
                    </p>
                    {actionLabel && href && (
                      <p className="mt-2 text-xs link-primary">{actionLabel}</p>
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
