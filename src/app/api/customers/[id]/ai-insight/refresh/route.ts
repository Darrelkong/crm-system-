export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { PermissionError, assertCanViewCustomerAiInsight } from "@/lib/permissions/customers";
import { getDb } from "@/lib/db";
import { refreshCustomerAiInsight } from "@/lib/ai/customer-insights/service";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getRequestMeta } from "@/lib/auth/cookies";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const db = getDb();
    const meta = getRequestMeta(request);

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

    const insight = await refreshCustomerAiInsight(db, user, customer);

    await writeAuditLog(
      {
        userId: user.id,
        action: "customer.ai_insight.refreshed",
        entityType: "customer",
        entityId: customer.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          customerId: customer.id,
          sourceHash: insight.sourceHash,
          model: insight.model,
        },
      },
      db,
    );

    return Response.json({ insight });
  } catch (error) {
    return authErrorResponse(error);
  }
}
