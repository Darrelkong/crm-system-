export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { NOTIFICATION_AUDIT_ACTIONS } from "@/lib/notifications/constants";
import { markNotificationRead } from "@/lib/notifications/queries";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const db = getDb();
    const { ipAddress, userAgent } = getRequestMeta(request);

    const result = await markNotificationRead(db, user.id, id);
    if (!result.ok) {
      if (result.reason === "not_found") {
        return Response.json(
          { error: "通知不存在", errorCode: "NOTIFICATION_NOT_FOUND" },
          { status: 404 },
        );
      }
      return Response.json(
        { error: "无权操作该通知", errorCode: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 },
      );
    }

    await writeAuditLog({
      userId: user.id,
      action: NOTIFICATION_AUDIT_ACTIONS.read,
      entityType: "notification",
      entityId: id,
      ipAddress,
      userAgent,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
