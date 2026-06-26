"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import {
  resolveNotificationMessage,
  resolveNotificationTitle,
} from "@/i18n/resolve-notification-content";
import type { NotificationListItem } from "@/lib/notifications/queries";

type NotificationCardItem = NotificationListItem & {
  href: string | null;
};

type Props = {
  items: NotificationCardItem[];
  unreadCount: number;
};

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

export function RecentNotificationsCardClient({ items, unreadCount }: Props) {
  const { t } = useTranslation();

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
      {items.length === 0 ? (
        <p className="text-sm text-[#6B7890]">{t("notifications.noNotifications")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const href = item.href;
            const inner = (
              <div
                className={
                  item.is_read
                    ? "rounded-xl border border-[#E3E8F0] bg-[#F7F9FC] px-3 py-2.5 transition-colors duration-200 hover:bg-[#E8F1FA]"
                    : "rounded-xl border border-[#C5DAF0] bg-[#E8F1FA] px-3 py-2.5 transition-colors duration-200 hover:bg-[#DCEAF7]"
                }
              >
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
