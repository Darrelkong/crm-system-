import type { NavIconId } from "@/lib/layout/nav-icons";

export type NavLink = {
  href: string;
  labelKey: string;
  icon: NavIconId;
  active?: boolean;
  mobilePrimary?: boolean;
  children?: NavLink[];
};

export type NavGroup = {
  id: string;
  labelKey: string;
  links: NavLink[];
};

export type MobileNavItem = {
  href: string;
  labelKey: string;
  icon:
    | "dashboard"
    | "customers"
    | "mail"
    | "notifications"
    | "workItems"
    | "publicPool"
    | "more";
};

function markActive(links: NavLink[], activeHref: string): NavLink[] {
  return links.map((link) => {
    const children = link.children
      ? markActive(link.children, activeHref)
      : undefined;
    const childActive = children?.some((c) => c.active) ?? false;
    const selfActive = isNavActive(link.href, activeHref);
    return {
      ...link,
      active: selfActive || childActive,
      children,
    };
  });
}

export function isNavActive(href: string, pathname: string): boolean {
  const hrefPath = href.split("?")[0] ?? href;
  if (hrefPath === "/admin" || hrefPath === "/staff") {
    return pathname === hrefPath;
  }
  if (hrefPath === "/work-items") {
    return pathname === "/work-items" || pathname.startsWith("/work-items/");
  }
  if (hrefPath === "/mail") {
    return pathname === "/mail" || pathname.startsWith("/mail/");
  }
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}

function dashboardHref(role: "admin" | "staff"): string {
  return role === "admin" ? "/admin" : "/staff";
}

const adminSystemSettingsChildren: NavLink[] = [
  {
    href: "/admin/login-logs",
    labelKey: "nav.loginLogs",
    icon: "loginLogs",
  },
  {
    href: "/admin/audit-logs",
    labelKey: "nav.auditLogs",
    icon: "auditLogs",
  },
  {
    href: "/admin/settings/security",
    labelKey: "nav.securityPolicies",
    icon: "securityPolicies",
  },
  {
    href: "/admin/backups",
    labelKey: "nav.backups",
    icon: "backups",
  },
  {
    href: "/import/customers",
    labelKey: "nav.customerImport",
    icon: "customerImport",
  },
  {
    href: "/export/customers",
    labelKey: "nav.dataExport",
    icon: "dataExport",
  },
];

export function getAdminNavGroups(activeHref?: string): NavGroup[] {
  const dash = dashboardHref("admin");
  const path = activeHref ?? "";

  const groups: NavGroup[] = [
    {
      id: "main",
      labelKey: "nav.group.main",
      links: [
        { href: dash, labelKey: "nav.dashboard", icon: "dashboard", mobilePrimary: true },
        { href: "/customers", labelKey: "nav.customers", icon: "customers", mobilePrimary: true },
        { href: "/mail", labelKey: "nav.mail", icon: "mail", mobilePrimary: true },
        { href: "/follow-ups", labelKey: "nav.followUps", icon: "followUps" },
        { href: "/public-pool", labelKey: "nav.publicPool", icon: "publicPool" },
      ],
    },
    {
      id: "workflow",
      labelKey: "nav.group.workflow",
      links: [
        { href: "/approvals", labelKey: "nav.approvals", icon: "approvals", mobilePrimary: true },
        { href: "/reports", labelKey: "nav.reports", icon: "reports" },
        {
          href: "/work-items?tab=tasks&view=open",
          labelKey: "nav.workItems",
          icon: "workItems",
        },
        {
          href: "/admin/announcements",
          labelKey: "nav.announcementManagement",
          icon: "announcementManagement",
        },
        { href: "/admin/ai-settings", labelKey: "nav.aiSettings", icon: "aiSettings" },
      ],
    },
    {
      id: "systemManagement",
      labelKey: "nav.group.systemManagement",
      links: [
        { href: "/admin/users", labelKey: "nav.userManagement", icon: "userManagement" },
        { href: "/admin/tags-stages", labelKey: "nav.tagsStages", icon: "tagsStages" },
        { href: "/admin/recycle-bin", labelKey: "nav.recycleBin", icon: "recycleBin" },
        {
          href: "/admin/settings",
          labelKey: "nav.systemSettings",
          icon: "systemSettings",
          children: adminSystemSettingsChildren,
        },
        { href: "/help", labelKey: "nav.help", icon: "help" },
      ],
    },
  ];

  return groups.map((g) => ({
    ...g,
    links: markActive(g.links, path),
  }));
}

export function getStaffNavGroups(activeHref?: string): NavGroup[] {
  const dash = dashboardHref("staff");
  const path = activeHref ?? "";

  const groups: NavGroup[] = [
    {
      id: "main",
      labelKey: "nav.group.main",
      links: [
        { href: dash, labelKey: "nav.dashboard", icon: "dashboard", mobilePrimary: true },
        { href: "/customers", labelKey: "nav.customers", icon: "customers", mobilePrimary: true },
        { href: "/mail", labelKey: "nav.mail", icon: "mail", mobilePrimary: true },
        { href: "/follow-ups", labelKey: "nav.followUps", icon: "followUps" },
        { href: "/public-pool", labelKey: "nav.publicPool", icon: "publicPool" },
      ],
    },
    {
      id: "workflow",
      labelKey: "nav.group.workflow",
      links: [
        { href: "/approvals", labelKey: "nav.approvals", icon: "approvals", mobilePrimary: true },
        { href: "/reports", labelKey: "nav.reports", icon: "reports" },
        {
          href: "/work-items?tab=tasks&view=open",
          labelKey: "nav.workItems",
          icon: "workItems",
        },
        { href: "/announcements", labelKey: "nav.announcements", icon: "announcements" },
        { href: "/help", labelKey: "nav.help", icon: "help" },
      ],
    },
  ];

  return groups.map((g) => ({
    ...g,
    links: markActive(g.links, path),
  }));
}

export function getRoleNavGroups(
  user: { role: "admin" | "staff" },
  activeHref?: string,
): NavGroup[] {
  return user.role === "admin"
    ? getAdminNavGroups(activeHref)
    : getStaffNavGroups(activeHref);
}

export function getMobileBottomNav(role: "admin" | "staff"): MobileNavItem[] {
  const dash = dashboardHref(role);
  if (role === "admin") {
    return [
      { href: dash, labelKey: "nav.dashboard", icon: "dashboard" },
      { href: "/customers", labelKey: "nav.customersMobile", icon: "customers" },
      { href: "/mail", labelKey: "nav.mail", icon: "mail" },
      {
        href: "/work-items?tab=notifications&view=unread",
        labelKey: "nav.workItems",
        icon: "workItems",
      },
      { href: "#more", labelKey: "nav.more", icon: "more" },
    ];
  }
  return [
    { href: dash, labelKey: "nav.dashboard", icon: "dashboard" },
    { href: "/customers", labelKey: "nav.customersMobile", icon: "customers" },
    { href: "/mail", labelKey: "nav.mail", icon: "mail" },
    {
      href: "/work-items?tab=notifications&view=unread",
      labelKey: "nav.workItems",
      icon: "workItems",
    },
    { href: "#more", labelKey: "nav.more", icon: "more" },
  ];
}

export function getUserInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}
