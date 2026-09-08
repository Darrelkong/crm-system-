import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getIdleLogoutMinutes } from "@/lib/auth/session-policy";
import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    return Response.json({
      inactivityLogoutMinutes: await getIdleLogoutMinutes(),
      accessLogoutPath: getPostLogoutRedirectPath(),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
