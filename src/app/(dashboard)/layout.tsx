import { IdleTimeoutProvider } from "@/components/auth/idle-timeout-provider";
import { INACTIVITY_LOGOUT_MINUTES } from "@/lib/auth/constants";

export const dynamic = "force-dynamic";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <IdleTimeoutProvider idleMinutes={INACTIVITY_LOGOUT_MINUTES}>
      {children}
    </IdleTimeoutProvider>
  );
}
