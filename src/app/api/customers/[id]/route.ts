export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import {
  formatCustomerForUser,
  PermissionError,
} from "@/lib/permissions/customers";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json({ error: "客户不存在" }, { status: 404 });
    }

    try {
      const view = formatCustomerForUser(user, customer);
      return Response.json({ customer: view });
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: "permission.denied.customer_access",
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
