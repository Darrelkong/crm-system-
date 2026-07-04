export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { getPendingApprovalCountForUser } from "@/lib/approvals/queries";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const db = getDb();
    const pendingCount = await getPendingApprovalCountForUser(db, user);
    return Response.json({ pendingCount });
  } catch (error) {
    return authErrorResponse(error);
  }
}
