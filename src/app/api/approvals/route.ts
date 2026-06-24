export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { listApprovalsForUser } from "@/lib/approvals/queries";
import type { ApprovalStatus } from "../../../../drizzle/schema/approvals";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const statusFilter =
      statusParam === "pending" ||
      statusParam === "approved" ||
      statusParam === "rejected"
        ? (statusParam as ApprovalStatus)
        : statusParam === "all"
          ? "all"
          : undefined;

    const db = getDb();
    const items = await listApprovalsForUser(db, user, statusFilter);

    return Response.json({ items, total: items.length });
  } catch (error) {
    return authErrorResponse(error);
  }
}
