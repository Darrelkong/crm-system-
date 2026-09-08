import { IdleTimeoutProvider } from "@/components/auth/idle-timeout-provider";
import { IdleExemptProvider } from "@/components/auth/idle-exempt-context";
import { IdleExemptModal } from "@/components/auth/idle-exempt-modal";
import { GlobalPrivacyScreen } from "@/components/privacy/global-privacy-screen";
import { NavigationPendingProvider } from "@/components/layout/navigation-pending";
import { GlobalWatermark } from "@/components/security/global-watermark";
import { LocalPreviewIdleSimulation } from "@/components/auth/local-preview-idle-simulation";
import { readServerNowMs } from "@/components/security/server-now";
import { getAuthValidationCached } from "@/lib/auth/request-cache";
import { DEFAULT_IDLE_TIMEOUT_MINUTES } from "@/lib/settings/idle-timeout";

export const dynamic = "force-dynamic";

function localAuthSimulationEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.CRM_LOCAL_PREVIEW_AUTH_SIMULATION_ENABLED === "true"
  );
}

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const validation = await getAuthValidationCached();
  const user = validation.ok ? validation.session.user : null;
  const idleMinutes = validation.ok
    ? validation.idleTimeoutMinutes
    : DEFAULT_IDLE_TIMEOUT_MINUTES;
  // force-dynamic layout: capture server clock once per request for watermark sync
  const serverNowMs = readServerNowMs();

  return (
    <IdleExemptProvider>
      <GlobalPrivacyScreen />
      <IdleTimeoutProvider idleMinutes={idleMinutes}>
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
      {localAuthSimulationEnabled() ? <LocalPreviewIdleSimulation /> : null}
    </IdleExemptProvider>
  );
}
