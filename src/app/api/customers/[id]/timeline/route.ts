export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { getCustomerTimeline } from "@/lib/customers/timeline/service";
import { PermissionError, resolveCustomerAccessOptions } from "@/lib/permissions/customers";
import { getDb } from "@/lib/db";
import { blockPendingOnHoldCreateCustomer } from "@/lib/customers/pending-on-hold-api";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const db = getDb();

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json({ error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    }

    const pendingBlock = await blockPendingOnHoldCreateCustomer(db, id);
    if (pendingBlock) {
      return pendingBlock;
    }

    const accessOptions = await resolveCustomerAccessOptions(db, user, id);

    try {
      const timeline = await getCustomerTimeline(db, user, customer, accessOptions);
      return Response.json(timeline);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: "permission.denied.customer_timeline_access",
          userId: user.id,
          entityType: "customer",
          entityId: id,
          metadata: { ownerId: customer.ownerId, status: customer.status },
        });
      }
      throw err;
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
