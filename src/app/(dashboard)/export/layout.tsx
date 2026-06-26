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
    >
      {children}
    </DashboardShell>
  );
}
