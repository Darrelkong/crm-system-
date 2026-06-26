export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { isAiApiKeyConfigured } from "@/lib/ai/env";
import {
  AiSettingsError,
  getAiSettings,
  updateAiSettings,
} from "@/lib/settings/ai-service";
import { requireUserManagementAdmin } from "@/lib/permissions/user-management";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    await requireUserManagementAdmin(request);
    const settings = await getAiSettings();
    return Response.json({
      settings,
      apiKeyConfigured: isAiApiKeyConfigured(),
    });
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

    const settings = await updateAiSettings(actor, body.settings, {
      ipAddress,
      userAgent,
    });

    return Response.json({
      settings,
      apiKeyConfigured: isAiApiKeyConfigured(),
    });
  } catch (error) {
    if (error instanceof AiSettingsError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
