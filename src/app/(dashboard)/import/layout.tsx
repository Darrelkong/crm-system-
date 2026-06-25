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
      titleKey="import.title"
      role="admin"
      userName={user.displayName}
      userEmail={user.email}
      navLinks={[
        { href: "/admin", labelKey: "nav.dashboard" },
        { href: "/customers", labelKey: "nav.customers" },
        { href: "/import/customers", labelKey: "nav.customerImport", active: true },
        { href: "/export/customers", labelKey: "nav.dataExport" },
        { href: "/public-pool", labelKey: "nav.publicPool" },
        { href: "/approvals", labelKey: "nav.approvals" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
