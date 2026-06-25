import type { NavLink } from "@/components/layout/dashboard-shell";

export function getAdminNavLinks(activeHref?: string): NavLink[] {
  return [
    { href: "/admin", labelKey: "nav.dashboard", active: activeHref === "/admin" },
    {
      href: "/customers",
      labelKey: "nav.customers",
      active: activeHref === "/customers",
    },
    {
      href: "/import/customers",
      labelKey: "nav.customerImport",
      active: activeHref === "/import/customers",
    },
    {
      href: "/export/customers",
      labelKey: "nav.dataExport",
      active: activeHref === "/export/customers",
    },
    {
      href: "/admin/backups",
      labelKey: "nav.dataBackup",
      active: activeHref === "/admin/backups",
    },
    {
      href: "/admin/users",
      labelKey: "nav.users",
      active: activeHref === "/admin/users",
    },
    {
      href: "/admin/login-logs",
      labelKey: "nav.loginLogs",
      active: activeHref === "/admin/login-logs",
    },
    {
      href: "/admin/settings",
      labelKey: "nav.settings",
      active: activeHref === "/admin/settings",
    },
    {
      href: "/admin/announcements",
      labelKey: "nav.announcementsAdmin",
      active: activeHref === "/admin/announcements",
    },
    {
      href: "/public-pool",
      labelKey: "nav.publicPool",
      active: activeHref === "/public-pool",
    },
    {
      href: "/approvals",
      labelKey: "nav.approvals",
      active: activeHref === "/approvals",
    },
    {
      href: "/notifications",
      labelKey: "nav.notifications",
      active: activeHref === "/notifications",
    },
    {
      href: "/announcements",
      labelKey: "nav.announcements",
      active: activeHref === "/announcements",
    },
    { href: "/help", labelKey: "nav.help", active: activeHref === "/help" },
  ];
}

export function getStaffNavLinks(activeHref?: string): NavLink[] {
  return [
    { href: "/staff", labelKey: "nav.dashboard", active: activeHref === "/staff" },
    {
      href: "/customers",
      labelKey: "nav.customers",
      active: activeHref === "/customers",
    },
    {
      href: "/public-pool",
      labelKey: "nav.publicPool",
      active: activeHref === "/public-pool",
    },
    {
      href: "/approvals",
      labelKey: "nav.approvals",
      active: activeHref === "/approvals",
    },
    {
      href: "/notifications",
      labelKey: "nav.notifications",
      active: activeHref === "/notifications",
    },
    {
      href: "/announcements",
      labelKey: "nav.announcements",
      active: activeHref === "/announcements",
    },
    { href: "/help", labelKey: "nav.help", active: activeHref === "/help" },
  ];
}

export function getRoleNavLinks(
  user: { role: "admin" | "staff" },
  activeHref?: string,
): NavLink[] {
  return user.role === "admin"
    ? getAdminNavLinks(activeHref)
    : getStaffNavLinks(activeHref);
}
