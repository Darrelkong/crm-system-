"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  LayoutDashboard,
  Mail,
  Menu,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { getMobileBottomNav } from "@/lib/layout/nav-links";
import { useTranslation } from "@/i18n/provider";
import { NotificationCountBadge } from "@/components/ui/notification-count-badge";
import { resolveMailNavigationUnreadBadgeCount } from "@/lib/mail/client/mail-navigation-badge";
import { resolveMailReadSource } from "@/lib/mail/client/mail-read-source";

const ICONS = {
  dashboard: LayoutDashboard,
  customers: Users,
  mail: Mail,
  workItems: ClipboardList,
  more: Menu,
} as const;

export function MailCompactNavRail({
  role,
  onMoreClick,
}: {
  role: "admin" | "staff";
  onMoreClick?: () => void;
}) {
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const items = getMobileBottomNav(role);
  const mailUnreadBadgeCount = resolveMailNavigationUnreadBadgeCount(
    resolveMailReadSource(),
  );

  return (
    <nav className="mail-compact-rail flex w-14 shrink-0 flex-col items-center gap-1 border-r crm-border py-3">
      {items.map((item) => {
        const Icon = ICONS[item.icon as keyof typeof ICONS] ?? Menu;
        const isMore = item.href === "#more";
        const itemPath = item.href.split("?")[0] ?? item.href;
        const isActive =
          !isMore &&
          (pathname === itemPath || pathname.startsWith(`${itemPath}/`));

        if (isMore) {
          return (
            <button
              key="more"
              type="button"
              onClick={onMoreClick}
              className="flex min-h-11 w-11 flex-col items-center justify-center rounded-xl mobile-nav-inactive"
              aria-label={t(item.labelKey)}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative flex min-h-11 w-11 items-center justify-center rounded-xl transition-colors",
              isActive ? "mobile-nav-active" : "mobile-nav-inactive",
            )}
            aria-label={item.icon === "mail" ? "Mail" : t(item.labelKey)}
            title={item.icon === "mail" ? "Mail" : undefined}
          >
            <Icon className="h-5 w-5" />
            {item.icon === "mail" && mailUnreadBadgeCount !== null && (
              <NotificationCountBadge
                count={mailUnreadBadgeCount}
                variant="overlay"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
