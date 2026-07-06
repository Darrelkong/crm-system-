import { IdleTimeoutProvider } from "@/components/auth/idle-timeout-provider";
import { IdleExemptProvider } from "@/components/auth/idle-exempt-context";
import { IdleExemptModal } from "@/components/auth/idle-exempt-modal";
import { NavigationPendingProvider } from "@/components/layout/navigation-pending";
import { INACTIVITY_LOGOUT_MINUTES } from "@/lib/auth/constants";

export const dynamic = "force-dynamic";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <IdleExemptProvider>
      <IdleTimeoutProvider idleMinutes={INACTIVITY_LOGOUT_MINUTES}>
        <NavigationPendingProvider>{children}</NavigationPendingProvider>
      </IdleTimeoutProvider>
      <IdleExemptModal />
    </IdleExemptProvider>
  );
}
