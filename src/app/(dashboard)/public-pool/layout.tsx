import { requireAuth } from "@/lib/permissions/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function PublicPoolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();
  const dashboardHref = user.role === "admin" ? "/admin" : "/staff";

  return (
    <DashboardShell
      titleKey="publicPool.title"
      role={user.role}
      userName={user.displayName}
      userEmail={user.email}
      navLinks={[
        { href: dashboardHref, labelKey: "nav.dashboard" },
        { href: "/customers", labelKey: "nav.customers" },
        { href: "/public-pool", labelKey: "nav.publicPool", active: true },
        { href: "/approvals", labelKey: "nav.approvals" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
