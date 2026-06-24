export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import {
  UserAdminError,
  unlockUserAccount,
} from "@/lib/users-admin/service";
import { requireUserManagementAdmin } from "@/lib/permissions/user-management";
import { authErrorResponse } from "@/lib/permissions/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireUserManagementAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const { id } = await context.params;

    await unlockUserAccount(actor, id, { ipAddress, userAgent });
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
