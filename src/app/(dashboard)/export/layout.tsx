import { requireExportAdmin } from "@/lib/permissions/export";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function ExportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireExportAdmin();

  return (
    <DashboardShell
      title="数据导出"
      roleLabel="Admin"
      userName={user.displayName}
      userEmail={user.email}
      navLinks={[
        { href: "/admin", label: "工作台" },
        { href: "/customers", label: "客户管理" },
        { href: "/import/customers", label: "客户导入" },
        { href: "/export/customers", label: "数据导出", active: true },
        { href: "/public-pool", label: "公共池" },
        { href: "/approvals", label: "审批中心" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
