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
import { isRelatedCustomerMissing } from "@/lib/notifications/queries";
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
        <h3 className="section-title">{t("notifications.recentTitle")}</h3>
        <span className="text-xs crm-text-secondary">
          {t("notifications.unreadCount", { count: String(unreadCount) })}
        </span>
      </div>
      {sortedItems.length === 0 ? (
        <p className="text-sm crm-text-secondary">{t("notifications.noNotifications")}</p>
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
                    ? "dashboard-notification-item"
                    : "dashboard-notification-item dashboard-notification-item--unread"
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="accent">
                    {t(`notificationCategories.${category}`)}
                  </Badge>
                  <span className="text-xs crm-text-secondary">{typeLabel}</span>
                </div>
                <p className="text-sm font-medium crm-text">
                  {safeResolveTitle(t, item)}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs crm-text-secondary">
                  {safeResolveMessage(t, item)}
                </p>
                <p className="mt-1 text-xs crm-text-secondary">
                  {formatCreatedAt(item.created_at)}
                  {!item.is_read && (
                    <span className="ml-2 font-medium crm-text-primary">
                      {t("notifications.unread")}
                    </span>
                  )}
                </p>
                {isRelatedCustomerMissing(item) && (
                  <p className="mt-1 text-xs crm-text-secondary">
                    {t("notifications.relatedCustomerMissing")}
                  </p>
                )}
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
        className="mt-4 inline-block text-sm link-primary hover:underline"
      >
        {t("notifications.enterCenter")}
      </Link>
    </Card>
  );
}
