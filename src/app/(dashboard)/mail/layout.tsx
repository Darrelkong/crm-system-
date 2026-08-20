import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getCurrentUserCached } from "@/lib/auth/request-cache";

export const dynamic = "force-dynamic";

export default async function MailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUserCached();

  if (!user) {
    redirect("/login?redirect=/mail");
  }

  if (user.role !== "admin") {
    redirect("/staff");
  }

  return (
    <DashboardShell
      titleKey="mail.title"
      role={user.role}
      userName={user.displayName}
      userEmail={user.email}
      contentClassName="w-full max-w-none min-w-0 px-0 py-0"
    >
      {children}
    </DashboardShell>
  );
}
