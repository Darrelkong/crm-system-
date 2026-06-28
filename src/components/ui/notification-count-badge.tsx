"use client";

import { cn } from "@/lib/cn";
import { formatNotificationBadgeCount } from "@/lib/notifications/badge-count";
import { useTranslation } from "@/i18n/provider";

type NotificationCountBadgeProps = {
  count: number;
  className?: string;
  /** Overlay on icon (mobile / collapsed sidebar). Inline sits beside label. */
  variant?: "inline" | "overlay";
};

export function NotificationCountBadge({
  count,
  className,
  variant = "inline",
}: NotificationCountBadgeProps) {
  const { t } = useTranslation();
  const label = formatNotificationBadgeCount(count);

  if (!label) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#FCE7EF] px-1 text-[11px] font-semibold leading-none text-[#B5496E]",
        variant === "overlay" &&
          "absolute -right-2 -top-1.5 border border-white shadow-sm",
        className,
      )}
      aria-label={t("notifications.unreadBadgeLabel", { count: String(count) })}
    >
      {label}
    </span>
  );
}
