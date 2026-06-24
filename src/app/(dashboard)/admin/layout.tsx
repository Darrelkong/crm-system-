import { requireAdmin } from "@/lib/permissions/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();

  return (
    <DashboardShell
      title="管理员工作台"
      roleLabel="Admin"
      userName={user.displayName}
      userEmail={user.email}
      navLinks={[
        { href: "/admin", label: "工作台", active: true },
        { href: "/customers", label: "客户管理" },
        { href: "/import/customers", label: "客户导入" },
        { href: "/export/customers", label: "数据导出" },
        { href: "/admin/backups", label: "数据备份" },
        { href: "/public-pool", label: "公共池" },
        { href: "/approvals", label: "审批中心" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
