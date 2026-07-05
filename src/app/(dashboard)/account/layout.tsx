export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthCached();

  return (
    <DashboardShell
      titleKey="nav.accountCenter"
      role={user.role}
      userName={user.displayName}
      userEmail={user.email}
    >
      {children}
    </DashboardShell>
  );
}
