import { requireAdmin } from "@/lib/permissions/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getAdminNavLinks } from "@/lib/layout/nav-links";

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
      navLinks={getAdminNavLinks()}
    >
      {children}
    </DashboardShell>
  );
}
