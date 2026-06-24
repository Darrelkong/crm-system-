import { requireImportAdmin } from "@/lib/permissions/import";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function ImportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireImportAdmin();

  return (
    <DashboardShell
      title="客户导入"
      roleLabel="Admin"
      userName={user.displayName}
      userEmail={user.email}
      navLinks={[
        { href: "/admin", label: "工作台" },
        { href: "/customers", label: "客户管理" },
        { href: "/import/customers", label: "客户导入", active: true },
        { href: "/public-pool", label: "公共池" },
        { href: "/approvals", label: "审批中心" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
