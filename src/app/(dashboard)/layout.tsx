import { getEffectiveSettings } from "@/lib/settings/effective";
import { IdleTimeoutProvider } from "@/components/auth/idle-timeout-provider";

export const dynamic = "force-dynamic";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getEffectiveSettings();

  return (
    <IdleTimeoutProvider idleMinutes={settings.inactivityLogoutMinutes}>
      {children}
    </IdleTimeoutProvider>
  );
}
