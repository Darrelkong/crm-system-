export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { listActiveStaffUsers } from "@/lib/users/queries";

export async function GET() {
  await requireAuth();
  const staff = await listActiveStaffUsers();
  return Response.json({ items: staff });
}
