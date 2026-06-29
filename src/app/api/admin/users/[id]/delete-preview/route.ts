export const dynamic = "force-dynamic";

import { getStaffDeletePreview } from "@/lib/users-admin/delete-preview";
import { UserAdminError } from "@/lib/users-admin/service";
import { requireUserManagementAdmin } from "@/lib/permissions/user-management";
import { authErrorResponse } from "@/lib/permissions/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireUserManagementAdmin(request);
    const { id } = await context.params;

    const preview = await getStaffDeletePreview(actor, id);
    return Response.json(preview);
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
