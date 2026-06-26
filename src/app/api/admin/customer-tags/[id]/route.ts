export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { authErrorResponse, requireAdmin } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import {
  CustomerTagError,
  CUSTOMER_TAG_AUDIT_ACTIONS,
  deleteCustomerTag,
  updateCustomerTagLabel,
} from "@/lib/customer-tags/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await context.params;
    const db = getDb();
    const { ipAddress, userAgent } = getRequestMeta(request);
    const body = (await request.json()) as { label?: string };

    const item = await updateCustomerTagLabel(db, id, body.label ?? "");

    await writeAuditLog({
      userId: actor.id,
      action: CUSTOMER_TAG_AUDIT_ACTIONS.updated,
      entityType: "customer_tag",
      entityId: item.id,
      ipAddress,
      userAgent,
      metadata: { tagKey: item.tagKey, label: item.label },
    });

    return Response.json({ item });
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

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await context.params;
    const db = getDb();
    const { ipAddress, userAgent } = getRequestMeta(request);

    const result = await deleteCustomerTag(db, id);

    await writeAuditLog({
      userId: actor.id,
      action: CUSTOMER_TAG_AUDIT_ACTIONS.deleted,
      entityType: "customer_tag",
      entityId: id,
      ipAddress,
      userAgent,
      metadata: { reassignedCustomerCount: result.reassignedCustomerCount },
    });

    return Response.json({ ok: true, ...result });
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
