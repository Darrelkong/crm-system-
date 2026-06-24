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
        { href: "/public-pool", label: "公共池" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
