import { requireStaff } from "@/lib/permissions/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getStaffNavLinks } from "@/lib/layout/nav-links";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireStaff();

  return (
    <DashboardShell
      titleKey="layout.staffDashboard"
      role="staff"
      userName={user.displayName}
      userEmail={user.email}
      navLinks={getStaffNavLinks()}
    >
      {children}
    </DashboardShell>
  );
}
