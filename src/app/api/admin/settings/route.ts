export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import {
  SettingsError,
  getSystemSettings,
  updateSystemSettings,
} from "@/lib/settings/service";
import { requireUserManagementAdmin } from "@/lib/permissions/user-management";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    await requireUserManagementAdmin(request);
    const settings = await getSystemSettings();
    return Response.json({ settings });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireUserManagementAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const body = (await request.json()) as { settings?: Record<string, string> };

    if (!body.settings || typeof body.settings !== "object") {
      return Response.json({ error: "settings 对象必填" }, { status: 400 });
    }

    const settings = await updateSystemSettings(actor, body.settings, {
      ipAddress,
      userAgent,
    });

    return Response.json({ settings });
  } catch (error) {
    if (error instanceof SettingsError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
