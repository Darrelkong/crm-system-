export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import {
  approvePendingDeviceWithReplacement,
  DeviceAdminError,
} from "@/lib/devices/service";
import { requireDeviceAdmin } from "@/lib/permissions/devices";
import { authErrorResponse } from "@/lib/permissions/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireDeviceAdmin(request);
    const body = (await request.json().catch(() => null)) as {
      replacementDeviceId?: unknown;
    } | null;
    if (
      !body ||
      typeof body.replacementDeviceId !== "string" ||
      body.replacementDeviceId.length === 0
    ) {
      throw new DeviceAdminError(
        "invalid_request",
        "請選擇要替換的已授權設備",
        400,
      );
    }

    const { ipAddress, userAgent } = getRequestMeta(request);
    const { id } = await context.params;
    await approvePendingDeviceWithReplacement(
      actor,
      id,
      body.replacementDeviceId,
      { ipAddress, userAgent },
    );
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof DeviceAdminError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}
