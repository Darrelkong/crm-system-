export const dynamic = "force-dynamic";

import { listLoginLogsForAdmin } from "@/lib/users-admin/queries";
import { requireUserManagementAdmin } from "@/lib/permissions/user-management";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    await requireUserManagementAdmin(request);
    const url = new URL(request.url);
    const email = url.searchParams.get("email");
    const successParam = url.searchParams.get("success");
    const success =
      successParam === "true" ? true : successParam === "false" ? false : null;

    const items = await listLoginLogsForAdmin({
      email,
      success,
      limit: 100,
    });

    return Response.json({ items, total: items.length });
  } catch (error) {
    return authErrorResponse(error);
  }
}
