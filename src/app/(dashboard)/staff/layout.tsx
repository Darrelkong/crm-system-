import { requireStaff } from "@/lib/permissions/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireStaff();

  return (
    <DashboardShell
      title="员工工作台"
      roleLabel="Staff"
      userName={user.displayName}
      userEmail={user.email}
      navLinks={[
        { href: "/staff", label: "工作台", active: true },
        { href: "/customers", label: "客户管理" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
