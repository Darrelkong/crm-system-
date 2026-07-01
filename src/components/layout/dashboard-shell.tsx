"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AccountMenu } from "@/components/layout/account-menu";
import {
  MobileBottomNav,
  MobileNavDrawer,
  SidebarNav,
} from "@/components/layout/app-navigation";
import { NotificationUnreadProvider } from "@/components/layout/notification-unread-context";
import { SystemStatusBadge } from "@/components/layout/system-status-badge";
import {
  getMobileBottomNav,
  getRoleNavGroups,
} from "@/lib/layout/nav-links";
import { useSidebarCollapsed } from "@/lib/layout/sidebar-state";
import { useTranslation } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui/classes";

export function DashboardShell({
  titleKey,
  role,
  userName,
  children,
}: {
  titleKey: string;
  role: "admin" | "staff";
  userName: string;
  userEmail?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();

  const navGroups = getRoleNavGroups({ role }, pathname);
  const mobileNav = getMobileBottomNav(role);

  const sidebarWidth = sidebarCollapsed ? "md:w-[4.5rem]" : "md:w-64 lg:w-72";
  const contentPad = sidebarCollapsed
    ? "md:pl-[4.5rem]"
    : "md:pl-64 lg:pl-72";

  return (
    <NotificationUnreadProvider>
    <div className="crm-app-bg min-h-dvh">
      <div className="flex min-h-dvh">
        <aside
          className={cn(
            "surface-sidebar fixed inset-y-0 left-0 z-30 hidden flex-col transition-[width] duration-200 ease-out md:flex",
            sidebarWidth,
          )}
        >
          <div className="border-b crm-border px-3 py-4">
            <div
              className={cn(
                "flex items-center gap-2",
                sidebarCollapsed ? "justify-center" : "justify-between",
              )}
            >
              <div
                className={cn(
                  "flex min-w-0 items-center gap-2.5",
                  sidebarCollapsed && "justify-center",
                )}
              >
                <div className="brand-logo flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white">
                  EF
                </div>
                {!sidebarCollapsed && (
                  <p className="truncate text-base font-semibold tracking-tight crm-text sm:text-lg">
                    {t("brand.crmName")}
                  </p>
                )}
              </div>
              {!sidebarCollapsed && (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="sidebar-icon-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  aria-label={t("nav.collapseSidebar")}
                  title={t("nav.collapseSidebar")}
                >
                  <PanelLeftClose className="h-5 w-5" />
                </button>
              )}
            </div>
            {sidebarCollapsed && (
              <button
                type="button"
                onClick={toggleSidebar}
                className="sidebar-icon-btn mt-3 flex h-9 w-full items-center justify-center rounded-lg"
                aria-label={t("nav.expandSidebar")}
                title={t("nav.expandSidebar")}
              >
                <PanelLeftOpen className="h-5 w-5" />
              </button>
            )}
          </div>
          <SidebarNav groups={navGroups} collapsed={sidebarCollapsed} />
          <div className="mt-auto border-t crm-border p-2">
            <AccountMenu
              userName={userName}
              role={role}
              collapsed={sidebarCollapsed}
            />
          </div>
        </aside>

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-out",
            contentPad,
          )}
        >
          <header className="surface-panel sticky top-0 z-20 border-b pt-[env(safe-area-inset-top,0px)]">
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 lg:py-4">
              <div className="min-w-0 flex-1">
                <h1 className="page-title truncate text-lg sm:text-xl">
                  {t(titleKey)}
                </h1>
              </div>
              <SystemStatusBadge />
            </div>
          </header>

          <main className={`crm-main-content ${ui.page} pb-24 md:pb-8`}>{children}</main>
        </div>
      </div>

      <MobileBottomNav
        items={mobileNav}
        activePath={pathname}
        onMoreClick={() => setDrawerOpen(true)}
      />

      <MobileNavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        groups={navGroups}
        userName={userName}
        role={role}
      />
    </div>
    </NotificationUnreadProvider>
  );
}
