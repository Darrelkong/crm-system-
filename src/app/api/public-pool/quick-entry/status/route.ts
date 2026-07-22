export const dynamic = "force-dynamic";

import {
  authErrorResponse,
  requireAuthSession,
  type AuthSessionContext,
} from "@/lib/public-pool/quick-entry-auth";
import {
  getQuickEntryGrantStatusForSession,
  type QuickEntryGrantStatus,
} from "@/lib/public-pool/quick-entry-security";

export type QuickEntryStatusRouteDeps = {
  requireAuthSession: () => Promise<AuthSessionContext>;
  getQuickEntryGrantStatusForSession: (
    sessionId: string,
  ) => Promise<QuickEntryGrantStatus>;
};

const defaultDeps: QuickEntryStatusRouteDeps = {
  requireAuthSession,
  getQuickEntryGrantStatusForSession,
};

export async function handleQuickEntryStatusGet(
  deps: QuickEntryStatusRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { sessionId } = await deps.requireAuthSession();
    const status = await deps.getQuickEntryGrantStatusForSession(sessionId);
    return Response.json({
      enabled: status.enabled,
      hasCode: status.hasCode,
      grantActive: status.grantActive,
      grantExpiresAt: status.grantExpiresAt,
      locked: status.locked,
      lockedUntil: status.lockedUntil,
      retryAfterSeconds: status.retryAfterSeconds,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function GET() {
  return handleQuickEntryStatusGet();
}
