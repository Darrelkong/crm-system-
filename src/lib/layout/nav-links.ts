import type { NavLink } from "@/components/layout/dashboard-shell";
import type { User } from "../../../drizzle/schema/users";

export function getAdminNavLinks(activeHref?: string): NavLink[] {
  return [
    { href: "/admin", label: "工作台", active: activeHref === "/admin" },
    { href: "/customers", label: "客户管理", active: activeHref === "/customers" },
    {
      href: "/import/customers",
      label: "客户导入",
      active: activeHref === "/import/customers",
    },
    {
      href: "/export/customers",
      label: "数据导出",
      active: activeHref === "/export/customers",
    },
    {
      href: "/admin/backups",
      label: "数据备份",
      active: activeHref === "/admin/backups",
    },
    {
      href: "/admin/users",
      label: "用户管理",
      active: activeHref === "/admin/users",
    },
    {
      href: "/admin/login-logs",
      label: "登录记录",
      active: activeHref === "/admin/login-logs",
    },
    {
      href: "/admin/settings",
      label: "系统设置",
      active: activeHref === "/admin/settings",
    },
    {
      href: "/admin/announcements",
      label: "公告管理",
      active: activeHref === "/admin/announcements",
    },
    { href: "/public-pool", label: "公共池", active: activeHref === "/public-pool" },
    { href: "/approvals", label: "审批中心", active: activeHref === "/approvals" },
    {
      href: "/notifications",
      label: "通知中心",
      active: activeHref === "/notifications",
    },
    {
      href: "/announcements",
      label: "公告",
      active: activeHref === "/announcements",
    },
    { href: "/help", label: "帮助中心", active: activeHref === "/help" },
  ];
}

export function getStaffNavLinks(activeHref?: string): NavLink[] {
  return [
    { href: "/staff", label: "工作台", active: activeHref === "/staff" },
    { href: "/customers", label: "客户管理", active: activeHref === "/customers" },
    { href: "/public-pool", label: "公共池", active: activeHref === "/public-pool" },
    { href: "/approvals", label: "审批中心", active: activeHref === "/approvals" },
    {
      href: "/notifications",
      label: "通知中心",
      active: activeHref === "/notifications",
    },
    {
      href: "/announcements",
      label: "公告",
      active: activeHref === "/announcements",
    },
    { href: "/help", label: "帮助中心", active: activeHref === "/help" },
  ];
}

export function getRoleNavLinks(user: User, activeHref?: string): NavLink[] {
  return user.role === "admin"
    ? getAdminNavLinks(activeHref)
    : getStaffNavLinks(activeHref);
}
