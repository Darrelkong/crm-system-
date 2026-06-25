import { requireExportAdmin } from "@/lib/permissions/export";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function ExportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireExportAdmin();

  return (
    <DashboardShell
      titleKey="export.title"
      role="admin"
      userName={user.displayName}
      userEmail={user.email}
      navLinks={[
        { href: "/admin", labelKey: "nav.dashboard" },
        { href: "/customers", labelKey: "nav.customers" },
        { href: "/import/customers", labelKey: "nav.customerImport" },
        { href: "/export/customers", labelKey: "nav.dataExport", active: true },
        { href: "/public-pool", labelKey: "nav.publicPool" },
        { href: "/approvals", labelKey: "nav.approvals" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
