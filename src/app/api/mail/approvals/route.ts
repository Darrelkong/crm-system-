export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import {
  listApprovalsForAuthor,
  listApprovalsForReviewer,
} from "@/lib/mail/outbound-approval-service";
import {
  hasMailOutboundApprovalReview,
} from "@/lib/permissions/mail";

const APPROVAL_STATUSES = new Set([
  "pending",
  "returned",
  "withdrawn",
  "approved",
]);

export async function GET(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    const statusParam = url.searchParams.get("status");
    const status =
      statusParam && APPROVAL_STATUSES.has(statusParam)
        ? (statusParam as "pending" | "returned" | "withdrawn" | "approved")
        : undefined;

    if (scope === "reviewer") {
      const items = await listApprovalsForReviewer(db, actor, {
        status,
      });
      return Response.json({ items });
    }

    if (scope === "author") {
      const items = await listApprovalsForAuthor(db, actor, {
        status,
      });
      return Response.json({ items });
    }

    if (hasMailOutboundApprovalReview(actor)) {
      const items = await listApprovalsForReviewer(db, actor, {
        status,
      });
      return Response.json({ items });
    }

    const items = await listApprovalsForAuthor(db, actor, {
      status: status ?? undefined,
    });
    return Response.json({ items });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
