export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { authErrorResponse, requireAdmin } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import {
  createCustomerTag,
  CustomerTagError,
  CUSTOMER_TAG_AUDIT_ACTIONS,
} from "@/lib/customer-tags/service";
import { listCustomerTags } from "@/lib/customer-tags/queries";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const db = getDb();
    const items = await listCustomerTags(db);
    return Response.json({ items });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const db = getDb();
    const { ipAddress, userAgent } = getRequestMeta(request);
    const body = (await request.json()) as { label?: string };

    const item = await createCustomerTag(db, body.label ?? "");

    await writeAuditLog({
      userId: actor.id,
      action: CUSTOMER_TAG_AUDIT_ACTIONS.created,
      entityType: "customer_tag",
      entityId: item.id,
      ipAddress,
      userAgent,
      metadata: { tagKey: item.tagKey, label: item.label },
    });

    return Response.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof CustomerTagError) {
      return Response.json(
        { error: error.message, errorCode: error.code },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}
