export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import {
  assertCanReleaseToPool,
  PermissionError,
} from "@/lib/permissions/customers";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { releaseCustomerToPool } from "@/lib/public-pool/service";
import { getRequestMeta } from "@/lib/auth/cookies";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const { ipAddress, userAgent } = getRequestMeta(request);

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json({ error: "客户不存在" }, { status: 404 });
    }

    try {
      assertCanReleaseToPool(user, customer);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: "customer.release_to_pool_failed.permission_denied",
          userId: user.id,
          entityType: "customer",
          entityId: id,
        });
      }
      throw err;
    }

    const body = (await request.json()) as { reason?: string };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!reason) {
      await writeAuditLog({
        userId: user.id,
        action: "customer.release_to_pool_failed.validation",
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
        metadata: { fieldErrors: [{ field: "reason", message: "释放原因必填" }] },
      });
      return Response.json(
        {
          error: "输入校验失败",
          fieldErrors: [{ field: "reason", message: "释放原因必填" }],
        },
        { status: 400 },
      );
    }

    await releaseCustomerToPool(customer, user, reason, {
      ipAddress,
      userAgent,
    });

    return Response.json({ ok: true, id });
  } catch (error) {
    return authErrorResponse(error);
  }
}
