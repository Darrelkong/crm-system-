"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import {
  Bell,
  ChevronDown,
  LayoutDashboard,
  Menu,
  Users,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { NavGroup, NavLink } from "@/lib/layout/nav-links";
import { navIcons } from "@/lib/layout/nav-icons";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { AccountMenu } from "@/components/layout/account-menu";
import { useNotificationUnreadCount } from "@/components/layout/notification-unread-context";
import {
  beginNavigationPending,
  isSameNavTarget,
  useNavigationPending,
} from "@/components/layout/navigation-pending";
import { NotificationCountBadge } from "@/components/ui/notification-count-badge";

const NOTIFICATIONS_HREF = "/notifications";

function NavLinkRow({
  link,
  collapsed,
  onNavigate,
  depth = 0,
}: {
  link: NavLink;
  collapsed: boolean;
  onNavigate?: () => void;
  depth?: number;
}) {
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const navigationPending = useNavigationPending();
  const hasChildren = (link.children?.length ?? 0) > 0;
  const childActive = link.children?.some((c) => c.active) ?? false;
  const shouldBeOpen = link.active || childActive;
  const [subOpenOverride, setSubOpenOverride] = useState<boolean | null>(null);
  const subOpen = subOpenOverride ?? shouldBeOpen;
  const isPending =
    navigationPending?.pendingHref === link.href &&
    !isSameNavTarget(link.href, pathname);

  const Icon = navIcons[link.icon];
  const label = t(link.labelKey);
  const unreadCount = useNotificationUnreadCount();
  const showNotificationBadge = link.href === NOTIFICATIONS_HREF;

  function handleNavigate() {
    beginNavigationPending(navigationPending, link.href, pathname);
    onNavigate?.();
  }

  if (hasChildren && !collapsed) {
    return (
      <li>
        <div
          className={cn(
            "flex items-center gap-1 rounded-xl",
            link.active && "nav-parent-active",
          )}
        >
          <Link
            href={link.href}
            onClick={handleNavigate}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
              link.active ? "nav-active" : "nav-item",
              isPending && !link.active && "nav-item-pending",
            )}
          >
            <span className="relative shrink-0">
              <Icon className="h-4 w-4" aria-hidden />
              {showNotificationBadge && (
                <NotificationCountBadge
                  count={unreadCount}
                  variant="overlay"
                />
              )}
            </span>
            <span className="truncate">{label}</span>
            {showNotificationBadge && (
              <NotificationCountBadge
                count={unreadCount}
                className="ml-auto"
              />
            )}
          </Link>
          <button
            type="button"
            onClick={() =>
              setSubOpenOverride((prev) => !(prev ?? shouldBeOpen))
            }
            className="sidebar-icon-btn mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            aria-expanded={subOpen}
            aria-label={subOpen ? t("common.collapse") : t("common.expand")}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                subOpen && "rotate-180",
              )}
            />
          </button>
        </div>
        {subOpen && (
          <ul className="crm-border-subtle mt-0.5 ml-5 space-y-0.5 border-l pl-3">
            {link.children!.map((child) => (
              <NavLinkRow
                key={child.href}
                link={child}
                collapsed={false}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <Link
        href={link.href}
        onClick={handleNavigate}
        title={collapsed ? label : undefined}
        className={cn(
          "flex items-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all duration-200",
          collapsed ? "justify-center px-2" : "w-full px-3",
          depth > 0 && !collapsed && "text-sm",
          isPending && !link.active && "nav-item-pending",
          link.active && !childActive
            ? "nav-active"
            : link.active
              ? "nav-sub-active"
              : "nav-item",
        )}
      >
        <span className="relative shrink-0">
          <Icon className="h-4 w-4" aria-hidden />
          {collapsed && showNotificationBadge && (
            <NotificationCountBadge count={unreadCount} variant="overlay" />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {showNotificationBadge && (
              <NotificationCountBadge count={unreadCount} className="ml-auto" />
            )}
          </>
        )}
      </Link>
    </li>
  );
}

export function SidebarNav({
  groups,
  collapsed = false,
  onNavigate,
}: {
  groups: NavGroup[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-2 py-4">
      {groups.map((group, index) => (
        <div
          key={group.id}
          className={cn(index > 0 && "mt-6 border-t crm-border pt-6")}
        >
          {!collapsed && (
            <p className="menu-group-label mb-2 px-3">
              {t(group.labelKey)}
            </p>
          )}
          {collapsed && index > 0 && <div className="mb-2" aria-hidden />}
          <ul className="space-y-0.5">
            {group.links.map((link) => (
              <NavLinkRow
                key={link.href}
                link={link}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function MobileNavDrawer({
  open,
  onClose,
  groups,
  userName,
  role,
}: {
  open: boolean;
  onClose: () => void;
  groups: NavGroup[];
  userName: string;
  role: "admin" | "staff";
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        className="mobile-drawer-overlay"
        aria-label="Close menu"
        onClick={onClose}
      />
      <aside className="mobile-drawer-panel absolute inset-y-0 left-0 flex w-[min(100vw-3rem,320px)] flex-col rounded-r-2xl">
        <div className="flex items-center justify-between border-b crm-border px-5 py-4">
          <p className="drawer-header-title">{t("nav.more")}</p>
          <button
            type="button"
            onClick={onClose}
            className="sidebar-icon-btn flex h-10 w-10 items-center justify-center rounded-xl"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <SidebarNav groups={groups} onNavigate={onClose} />
        <div className="border-t crm-border p-4">
          <AccountMenu userName={userName} role={role} onNavigate={onClose} />
        </div>
      </aside>
    </div>
  );
}

export function MobileBottomNav({
  items,
  activePath,
  onMoreClick,
}: {
  items: Array<{ href: string; labelKey: string; icon: string }>;
  activePath: string;
  onMoreClick: () => void;
}) {
  const { t } = useTranslation();
  const navigationPending = useNavigationPending();
  const unreadCount = useNotificationUnreadCount();

  const icons: Record<string, ComponentType<{ className?: string }>> = {
    dashboard: LayoutDashboard,
    customers: Users,
    notifications: Bell,
    publicPool: Waves,
    more: Menu,
  };

  return (
    <nav className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden">
      <ul className="flex items-stretch justify-around gap-1">
        {items.map((item) => {
          const Icon = icons[item.icon] ?? Menu;
          const isMore = item.href === "#more";
          const isActive =
            !isMore &&
            (activePath === item.href || activePath.startsWith(`${item.href}/`));
          const isPending =
            navigationPending?.pendingHref === item.href &&
            !isSameNavTarget(item.href, activePath);

          if (isMore) {
            return (
              <li key="more" className="flex-1">
                <button
                  type="button"
                  onClick={onMoreClick}
                  className="mobile-nav-inactive flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium"
                >
                  <Icon className="h-5 w-5" />
                  <span>{t(item.labelKey)}</span>
                </button>
              </li>
            );
          }

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                onClick={() =>
                  beginNavigationPending(navigationPending, item.href, activePath)
                }
                className={cn(
                  isActive
                    ? "mobile-nav-active flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-colors duration-200"
                    : "mobile-nav-inactive flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-colors duration-200",
                  isPending && !isActive && "nav-item-pending",
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {item.href === NOTIFICATIONS_HREF && (
                    <NotificationCountBadge
                      count={unreadCount}
                      variant="overlay"
                    />
                  )}
                </span>
                <span className="max-w-full truncate">{t(item.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
