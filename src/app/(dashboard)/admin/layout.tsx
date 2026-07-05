import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getCurrentUserCached } from "@/lib/auth/request-cache";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUserCached();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "admin") {
    redirect("/staff");
  }

  return (
    <DashboardShell
      titleKey="layout.adminDashboard"
      role="admin"
      userName={user.displayName}
      userEmail={user.email}
    >
      {children}
    </DashboardShell>
  );
}
