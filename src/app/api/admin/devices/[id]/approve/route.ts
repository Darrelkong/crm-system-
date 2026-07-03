export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import {
  approveAuthorizedDevice,
  DeviceAdminError,
} from "@/lib/devices/service";
import { requireDeviceAdmin } from "@/lib/permissions/devices";
import { authErrorResponse } from "@/lib/permissions/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireDeviceAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const { id } = await context.params;
    await approveAuthorizedDevice(actor, id, { ipAddress, userAgent });
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
