"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import {
  resolveNotificationMessage,
  resolveNotificationTitle,
} from "@/i18n/resolve-notification-content";
import type { NotificationListItem } from "@/lib/notifications/queries";

type Props = {
  items: NotificationListItem[];
  unreadCount: number;
  getHref: (item: NotificationListItem) => string | null;
};

export function RecentNotificationsCardClient({
  items,
  unreadCount,
  getHref,
}: Props) {
  const { t } = useTranslation();

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">
          {t("notifications.recentTitle")}
        </h3>
        <span className="text-xs text-slate-500">
          {t("notifications.unreadCount", { count: String(unreadCount) })}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{t("notifications.noNotifications")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const href = getHref(item);
            const inner = (
              <div
                className={
                  item.is_read
                    ? "rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                    : "rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2"
                }
              >
                <p className="text-sm font-medium text-slate-900">
                  {resolveNotificationTitle(t, item)}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                  {resolveNotificationMessage(t, item)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {item.created_at.slice(0, 16).replace("T", " ")}
                  {!item.is_read && (
                    <span className="ml-2 font-medium text-indigo-600">
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
        className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
      >
        {t("notifications.enterCenter")}
      </Link>
    </Card>
  );
}
