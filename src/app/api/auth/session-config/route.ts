import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { INACTIVITY_LOGOUT_MINUTES } from "@/lib/auth/constants";
import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    return Response.json({
      inactivityLogoutMinutes: INACTIVITY_LOGOUT_MINUTES,
      accessLogoutPath: getPostLogoutRedirectPath(),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
