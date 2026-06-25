import { requireAuth } from "@/lib/permissions/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function CustomersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();
  const dashboardHref = user.role === "admin" ? "/admin" : "/staff";

  return (
    <DashboardShell
      titleKey="nav.customers"
      role={user.role}
      userName={user.displayName}
      userEmail={user.email}
      navLinks={[
        { href: dashboardHref, labelKey: "nav.dashboard" },
        { href: "/customers", labelKey: "nav.customers", active: true },
        { href: "/public-pool", labelKey: "nav.publicPool" },
        { href: "/approvals", labelKey: "nav.approvals" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
