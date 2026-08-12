export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { listApprovalsForUser } from "@/lib/approvals/queries";
import {
  loadFamilyLinkAdminDetails,
  sanitizeApprovalListItemForUser,
} from "@/lib/approvals/family-link-serialization";
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
    const familyAdminDetails =
      user.role === "admin"
        ? await loadFamilyLinkAdminDetails(db, items)
        : undefined;

    const serialized = items.map((item) =>
      sanitizeApprovalListItemForUser(user, item, familyAdminDetails),
    );

    return Response.json({ items: serialized, total: serialized.length });
  } catch (error) {
    return authErrorResponse(error);
  }
}
