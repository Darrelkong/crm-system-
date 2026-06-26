"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card, Badge } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
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

type NotificationCardItem = NotificationListItem & {
  href: string | null;
};

type Props = {
  items: NotificationCardItem[];
  unreadCount: number;
};

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

export function RecentNotificationsCardClient({ items, unreadCount }: Props) {
  const { t } = useTranslation();

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

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#172033]">
          {t("notifications.recentTitle")}
        </h3>
        <span className="text-xs text-[#6B7890]">
          {t("notifications.unreadCount", { count: String(unreadCount) })}
        </span>
      </div>
      {sortedItems.length === 0 ? (
        <p className="text-sm text-[#6B7890]">{t("notifications.noNotifications")}</p>
      ) : (
        <ul className="space-y-2">
          {sortedItems.map((item) => {
            const href = item.href;
            const category = getNotificationCategory(item.type);
            const typeKey = getNotificationTypeLabelKey(item.type);
            const typeLabel =
              t(typeKey) === typeKey ? item.type : t(typeKey);
            const inner = (
              <div
                className={
                  item.is_read
                    ? "rounded-xl border border-[#E3E8F0] bg-[#F7F9FC] px-3 py-2.5 transition-colors duration-200 hover:bg-[#EEF3F8]"
                    : "rounded-xl border border-[#C5DAF0] bg-[#E8F1FA] px-3 py-2.5 transition-colors duration-200 hover:bg-[#DCEAF7]"
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="accent">
                    {t(`notificationCategories.${category}`)}
                  </Badge>
                  <span className="text-xs text-[#6B7890]">{typeLabel}</span>
                </div>
                <p className="text-sm font-medium text-[#172033]">
                  {safeResolveTitle(t, item)}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-[#6B7890]">
                  {safeResolveMessage(t, item)}
                </p>
                <p className="mt-1 text-xs text-[#6B7890]">
                  {formatCreatedAt(item.created_at)}
                  {!item.is_read && (
                    <span className="ml-2 font-medium text-[#2F6FB3]">
                      {t("notifications.unread")}
                    </span>
                  )}
                </p>
              </div>
            );
            return (
              <li key={item.id}>
                {href ? (
                  <Link href={href} className="block hover:opacity-90">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href="/notifications"
        className="mt-4 inline-block text-sm text-[#2F6FB3] hover:text-[#1F4E79] hover:underline"
      >
        {t("notifications.enterCenter")}
      </Link>
    </Card>
  );
}
