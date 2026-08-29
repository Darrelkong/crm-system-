import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getCurrentUserCached } from "@/lib/auth/request-cache";
import { getMailWorkspaceLayoutRedirect } from "@/lib/mail/mail-workspace-route-access";

export const dynamic = "force-dynamic";

export default async function MailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUserCached();
  const layoutRedirect = getMailWorkspaceLayoutRedirect(user);

  if (layoutRedirect) {
    redirect(layoutRedirect);
  }

  return (
    <DashboardShell
      titleKey="mail.title"
      role={user!.role}
      userName={user!.displayName}
      userEmail={user!.email}
      contentClassName="flex h-full min-h-0 w-full max-w-none min-w-0 flex-col px-0 py-0"
    >
      {children}
    </DashboardShell>
  );
}
