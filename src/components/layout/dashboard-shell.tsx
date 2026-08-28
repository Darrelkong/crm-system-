"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AccountMenu } from "@/components/layout/account-menu";
import {
  MobileBottomNav,
  MobileNavDrawer,
  SidebarNav,
} from "@/components/layout/app-navigation";
import { NotificationUnreadProvider } from "@/components/layout/notification-unread-context";
import { ApprovalPendingProvider } from "@/components/layout/approval-pending-context";
import { NavigationProgressBar } from "@/components/layout/navigation-progress-bar";
import { SystemStatusBadge } from "@/components/layout/system-status-badge";
import {
  getMobileBottomNav,
  getRoleNavGroups,
} from "@/lib/layout/nav-links";
import { useSidebarCollapsed } from "@/lib/layout/sidebar-state";
import { useTranslation } from "@/i18n/provider";
import { brandWordmarkFont } from "@/lib/fonts/brand-wordmark-font";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui/classes";

export function DashboardShell({
  titleKey,
  role,
  userName,
  children,
  contentClassName,
}: {
  titleKey: string;
  role: "admin" | "staff";
  userName: string;
  userEmail?: string;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();

  const navGroups = getRoleNavGroups({ role }, pathname);
  const mobileNav = getMobileBottomNav(role);

  const sidebarWidth = sidebarCollapsed ? "md:w-[4.5rem]" : "md:w-64 lg:w-72";
  const brandZoneWidth = sidebarWidth;
  const contentPad = sidebarCollapsed
    ? "md:pl-[4.5rem]"
    : "md:pl-64 lg:pl-72";

  return (
    <NotificationUnreadProvider>
    <ApprovalPendingProvider>
    <div className="dashboard-shell crm-app-bg min-h-dvh">
      <header className="dashboard-unified-header surface-panel relative sticky top-0 z-40 hidden w-full md:block pt-[env(safe-area-inset-top,0px)]">
        <NavigationProgressBar />
        <div className="flex w-full items-center py-2 lg:py-2.5">
          <div
            className={cn(
              "flex shrink-0 items-center transition-[width] duration-200 ease-out",
              brandZoneWidth,
              sidebarCollapsed
                ? "justify-center gap-0 px-0"
                : "gap-2.5 px-3",
            )}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-visible">
              <span
                className="dashboard-brand-logo-mark"
                role="img"
                aria-label=""
              />
            </div>
            {!sidebarCollapsed && (
              <p
                className={cn(
                  "min-w-0 flex-1 truncate text-[20px] font-semibold leading-none tracking-[-0.015em] crm-text",
                  brandWordmarkFont.className,
                )}
              >
                {t("brand.crmName")}
              </p>
            )}
            <button
              type="button"
              onClick={toggleSidebar}
              className="sidebar-edge-handle sidebar-icon-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
              aria-label={
                sidebarCollapsed
                  ? t("nav.expandSidebar")
                  : t("nav.collapseSidebar")
              }
              title={
                sidebarCollapsed
                  ? t("nav.expandSidebar")
                  : t("nav.collapseSidebar")
              }
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
            <h1 className="page-title min-w-0 flex-1 truncate text-lg sm:text-xl">
              {t(titleKey)}
            </h1>
            <SystemStatusBadge />
          </div>
        </div>
      </header>

      <div className="flex min-h-dvh md:min-h-0">
        <aside
          className={cn(
            "surface-sidebar dashboard-sidebar fixed bottom-0 left-0 z-30 hidden flex-col transition-[width] duration-200 ease-out md:flex",
            sidebarWidth,
          )}
        >
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
          <header className="surface-panel relative sticky top-0 z-20 border-b pt-[env(safe-area-inset-top,0px)] md:hidden">
            <NavigationProgressBar />
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6">
              <div className="min-w-0 flex-1">
                <h1 className="page-title truncate text-lg sm:text-xl">
                  {t(titleKey)}
                </h1>
              </div>
              <SystemStatusBadge />
            </div>
          </header>

          <main
            className={cn(
              "crm-main-content pb-24 md:pb-8",
              contentClassName ?? ui.page,
            )}
          >
            {children}
          </main>
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
    </ApprovalPendingProvider>
    </NotificationUnreadProvider>
  );
}
