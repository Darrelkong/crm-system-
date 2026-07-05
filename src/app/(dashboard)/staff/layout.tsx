import { requireStaffCached } from "@/lib/auth/request-cache";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireStaffCached();

  return (
    <DashboardShell
      titleKey="layout.staffDashboard"
      role="staff"
      userName={user.displayName}
      userEmail={user.email}
    >
      {children}
    </DashboardShell>
  );
}
