export const dynamic = "force-dynamic";

import { listRecycleBinCustomers } from "@/lib/recycle-bin/queries";
import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const items = await listRecycleBinCustomers();
    return Response.json({ items, total: items.length });
  } catch (error) {
    return authErrorResponse(error);
  }
}
