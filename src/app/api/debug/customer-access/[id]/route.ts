export const dynamic = "force-dynamic";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  authErrorResponse,
  formatCustomerForUser,
  getCustomerAccessLevel,
  resolveCustomerAccessOptions,
  PermissionError,
} from "@/lib/permissions";
import { logPermissionDenied } from "@/lib/permissions/audit";
import {
  debugDisabledResponse,
  requireDebugApiAdmin,
} from "@/lib/debug/guard";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireDebugApiAdmin(request);
    const { id } = await context.params;

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, id))
      .limit(1);
    const customer = rows[0];

    if (!customer) {
      return Response.json({ error: "客户不存在" }, { status: 404 });
    }

    const accessOptions = await resolveCustomerAccessOptions(db, user, id);
    const accessLevel = getCustomerAccessLevel(user, customer, accessOptions);
    const isAssignee = !!accessOptions.isAssignee;

    if (accessLevel === "denied") {
      await logPermissionDenied(request, {
        action: "permission.denied.customer_access",
        userId: user.id,
        entityType: "customer",
        entityId: customer.id,
        metadata: {
          ownerId: customer.ownerId,
          status: customer.status,
        },
      });
      throw new PermissionError(
        403,
        "无权访问该客户",
        "permission.denied.customer_access",
      );
    }

    const customerView = formatCustomerForUser(user, customer, accessOptions);

    return Response.json({
      accessLevel,
      isAssignee,
      isMasked: customerView.isMasked,
      customer: customerView,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("disabled")) {
      return debugDisabledResponse();
    }
    return authErrorResponse(error);
  }
}
