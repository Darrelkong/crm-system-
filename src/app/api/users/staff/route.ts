export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { listActiveStaffUsers } from "@/lib/users/queries";

export async function GET(request: Request) {
  try {
    await requireAuth(request);
    const staff = await listActiveStaffUsers();
    return Response.json({ items: staff });
  } catch (error) {
    return authErrorResponse(error);
  }
}
