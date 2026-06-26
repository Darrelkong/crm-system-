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
import type { NavGroup, NavLink } from "@/lib/layout/nav-links";
import { navIcons } from "@/lib/layout/nav-icons";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { AccountMenu } from "@/components/layout/account-menu";

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
  const hasChildren = (link.children?.length ?? 0) > 0;
  const childActive = link.children?.some((c) => c.active) ?? false;
  const shouldBeOpen = link.active || childActive;
  const [subOpenOverride, setSubOpenOverride] = useState<boolean | null>(null);
  const subOpen = subOpenOverride ?? shouldBeOpen;

  const Icon = navIcons[link.icon];
  const label = t(link.labelKey);

  if (hasChildren && !collapsed) {
    return (
      <li>
        <div
          className={cn(
            "flex items-center gap-1 rounded-xl",
            link.active && "bg-[#E8F1FA]",
          )}
        >
          <Link
            href={link.href}
            onClick={onNavigate}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
              link.active ? "nav-active" : "nav-item text-[#6B7890]",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </Link>
          <button
            type="button"
            onClick={() =>
              setSubOpenOverride((prev) => !(prev ?? shouldBeOpen))
            }
            className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#6B7890] hover:bg-[#E8F1FA]"
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
          <ul className="mt-0.5 space-y-0.5 border-l border-[#E3E8F0] pl-3 ml-5">
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
        onClick={onNavigate}
        title={collapsed ? label : undefined}
        className={cn(
          "flex items-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all duration-200",
          collapsed ? "justify-center px-2" : "px-3",
          depth > 0 && !collapsed && "text-sm",
          link.active && !childActive
            ? "nav-active"
            : link.active
              ? "bg-[#E8F1FA] text-[#1F4E79]"
              : "nav-item text-[#6B7890]",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {!collapsed && <span className="truncate">{label}</span>}
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
          className={cn(index > 0 && "mt-6 border-t border-[#E3E8F0] pt-6")}
        >
          {!collapsed && (
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-[#6B7890]">
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
        <div className="flex items-center justify-between border-b border-[#E3E8F0] px-5 py-4">
          <p className="text-sm font-semibold text-[#172033]">{t("nav.more")}</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-[#6B7890] hover:bg-[#E8F1FA]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <SidebarNav groups={groups} onNavigate={onClose} />
        <div className="border-t border-[#E3E8F0] p-4">
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

          if (isMore) {
            return (
              <li key="more" className="flex-1">
                <button
                  type="button"
                  onClick={onMoreClick}
                  className="flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium text-[#6B7890] active:bg-[#E8F1FA]"
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
                className={cn(
                  "flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-colors duration-200",
                  isActive
                    ? "bg-[#2F6FB3] text-white shadow-[0_2px_8px_rgba(47,111,179,0.28)]"
                    : "text-[#6B7890] active:bg-[#E8F1FA]",
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="max-w-full truncate">{t(item.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
