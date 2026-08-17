export const dynamic = "force-dynamic";

import { authErrorResponse, requireAuth } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { buildCustomerSourceMenuOptions } from "@/lib/customer-sources/keys";

/** Staff-safe source menu for create/edit selectors — no customer counts. */
export async function GET(request: Request) {
  try {
    await requireAuth(request);
    const db = getDb();
    const options = await buildCustomerSourceMenuOptions(db);
    return Response.json({ options });
  } catch (error) {
    return authErrorResponse(error);
  }
}
