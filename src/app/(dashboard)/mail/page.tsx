import { Suspense } from "react";
import { MailPrototypeProvider } from "@/lib/mail/prototype/state";
import { MailSessionProvider } from "@/lib/mail/client/mail-session-provider";
import { MailWorkspaceDataSourceBoundary } from "@/lib/mail/client/mail-workspace-data-source-boundary";
import { MailPrototypeShell } from "@/components/mail/prototype/mail-prototype-shell";
import { getCurrentUserCached } from "@/lib/auth/request-cache";
import { resolveMailWorkspaceDashboardHref } from "@/lib/mail/mail-workspace-route-access";

export default async function MailPage() {
  const user = await getCurrentUserCached();
  const dashboardHref = resolveMailWorkspaceDashboardHref(user?.role ?? "staff");

  return (
    <MailSessionProvider>
      <MailWorkspaceDataSourceBoundary>
        <MailPrototypeProvider>
          <Suspense fallback={null}>
            <MailPrototypeShell
              role={user?.role ?? "staff"}
              dashboardHref={dashboardHref}
            />
          </Suspense>
        </MailPrototypeProvider>
      </MailWorkspaceDataSourceBoundary>
    </MailSessionProvider>
  );
}
