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
    >
      {children}
    </DashboardShell>
  );
}
