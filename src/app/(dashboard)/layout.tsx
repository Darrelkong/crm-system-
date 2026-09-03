import { IdleTimeoutProvider } from "@/components/auth/idle-timeout-provider";
import { IdleExemptProvider } from "@/components/auth/idle-exempt-context";
import { IdleExemptModal } from "@/components/auth/idle-exempt-modal";
import { GlobalPrivacyScreen } from "@/components/privacy/global-privacy-screen";
import { NavigationPendingProvider } from "@/components/layout/navigation-pending";
import { GlobalWatermark } from "@/components/security/global-watermark";
import { readServerNowMs } from "@/components/security/server-now";
import { getCurrentUserCached } from "@/lib/auth/request-cache";
import { INACTIVITY_LOGOUT_MINUTES } from "@/lib/auth/constants";

export const dynamic = "force-dynamic";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUserCached();
  // force-dynamic layout: capture server clock once per request for watermark sync
  const serverNowMs = readServerNowMs();

  return (
    <IdleExemptProvider>
      <GlobalPrivacyScreen />
      <IdleTimeoutProvider idleMinutes={INACTIVITY_LOGOUT_MINUTES}>
        <NavigationPendingProvider>{children}</NavigationPendingProvider>
      </IdleTimeoutProvider>
      <IdleExemptModal />
      {user ? (
        <GlobalWatermark
          userId={user.id}
          displayName={user.displayName}
          email={user.email}
          serverNowMs={serverNowMs}
        />
      ) : null}
    </IdleExemptProvider>
  );
}
