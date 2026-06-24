export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { formatPublicPoolListForUser } from "@/lib/public-pool/queries";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const items = await formatPublicPoolListForUser(user);
    return Response.json({ items, total: items.length });
  } catch (error) {
    return authErrorResponse(error);
  }
}
