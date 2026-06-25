export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getRoleNavLinks } from "@/lib/layout/nav-links";

export default async function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();

  return (
    <DashboardShell
      titleKey="notifications.title"
      role={user.role}
      userName={user.displayName}
      userEmail={user.email}
      navLinks={getRoleNavLinks(user, "/notifications")}
    >
      {children}
    </DashboardShell>
  );
}
