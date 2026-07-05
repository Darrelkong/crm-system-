export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthCached();

  return (
    <DashboardShell
      titleKey="help.title"
      role={user.role}
      userName={user.displayName}
      userEmail={user.email}
    >
      {children}
    </DashboardShell>
  );
}
