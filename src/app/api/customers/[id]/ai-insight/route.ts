export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { PermissionError, assertCanViewCustomerAiInsight } from "@/lib/permissions/customers";
import { getDb } from "@/lib/db";
import { getCustomerAiInsightBundleForUser } from "@/lib/ai/customer-insights/service";

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

    try {
      assertCanViewCustomerAiInsight(user, customer);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: err.auditAction ?? "permission.denied.customer_ai_insight",
          userId: user.id,
          entityType: "customer",
          entityId: id,
        });
      }
      throw err;
    }

    const bundle = await getCustomerAiInsightBundleForUser(db, user, customer);
    return Response.json(bundle);
  } catch (error) {
    return authErrorResponse(error);
  }
}
