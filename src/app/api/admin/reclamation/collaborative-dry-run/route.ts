export const dynamic = "force-dynamic";

import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { getCollaborativeDissolutionDryRunForAdmin } from "@/lib/reclamation/collaborative-dry-run-api";

export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    const db = getDb();
    const result = await getCollaborativeDissolutionDryRunForAdmin(user, db);
    return Response.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
