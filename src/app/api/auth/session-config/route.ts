import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { ACCESS_LOGOUT_PATH } from "@/lib/auth/constants";
import { getEffectiveSettings } from "@/lib/settings/effective";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const settings = await getEffectiveSettings();
    return Response.json({
      inactivityLogoutMinutes: settings.inactivityLogoutMinutes,
      accessLogoutPath: ACCESS_LOGOUT_PATH,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
