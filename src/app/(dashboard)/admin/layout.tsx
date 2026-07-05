import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getCurrentUser } from "@/lib/permissions/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

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
