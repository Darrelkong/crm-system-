import { requireAuth } from "@/lib/permissions/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function ApprovalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();
  const dashboardHref = user.role === "admin" ? "/admin" : "/staff";

  return (
    <DashboardShell
      title="审批中心"
      roleLabel={user.role === "admin" ? "Admin" : "Staff"}
      userName={user.displayName}
      userEmail={user.email}
      navLinks={[
        { href: dashboardHref, label: "工作台" },
        { href: "/customers", label: "客户管理" },
        { href: "/public-pool", label: "公共池" },
        { href: "/approvals", label: "审批中心", active: true },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
