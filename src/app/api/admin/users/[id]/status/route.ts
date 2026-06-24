export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import {
  UserAdminError,
  setUserStatus,
} from "@/lib/users-admin/service";
import { requireUserManagementAdmin } from "@/lib/permissions/user-management";
import { authErrorResponse } from "@/lib/permissions/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireUserManagementAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const { id } = await context.params;
    const body = (await request.json()) as { status?: string };

    if (body.status !== "active" && body.status !== "disabled") {
      return Response.json({ error: "status 必须为 active 或 disabled" }, { status: 400 });
    }

    await setUserStatus(actor, id, body.status, { ipAddress, userAgent });
    return Response.json({ ok: true, status: body.status });
  } catch (error) {
    if (error instanceof UserAdminError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}
