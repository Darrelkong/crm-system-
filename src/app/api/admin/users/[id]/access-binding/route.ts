export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { authErrorResponse } from "@/lib/permissions/auth";
import { requireUserManagementAdmin } from "@/lib/permissions/user-management";
import {
  resetStaffCloudflareAccessBinding,
  UserAdminError,
} from "@/lib/users-admin/service";

type RouteContext = { params: Promise<unknown> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireUserManagementAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const { id } = (await context.params) as { id: string };
    await resetStaffCloudflareAccessBinding(actor, id, {
      ipAddress,
      userAgent,
    });
    return Response.json({ ok: true });
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
