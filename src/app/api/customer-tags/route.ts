export const dynamic = "force-dynamic";

import { authErrorResponse, requireAuth } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { listActiveCustomerTags } from "@/lib/customer-tags/queries";

export async function GET(request: Request) {
  try {
    await requireAuth(request);
    const db = getDb();
    const items = await listActiveCustomerTags(db);
    return Response.json({ items });
  } catch (error) {
    return authErrorResponse(error);
  }
}
