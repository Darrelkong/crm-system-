export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { NOTIFICATION_AUDIT_ACTIONS } from "@/lib/notifications/constants";
import { markAllNotificationsRead } from "@/lib/notifications/queries";

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth(request);
    const db = getDb();
    const { ipAddress, userAgent } = getRequestMeta(request);

    const markedCount = await markAllNotificationsRead(db, user.id);

    await writeAuditLog({
      userId: user.id,
      action: NOTIFICATION_AUDIT_ACTIONS.readAll,
      entityType: "notification",
      ipAddress,
      userAgent,
      metadata: { markedCount },
    });

    return Response.json({ ok: true, markedCount });
  } catch (error) {
    return authErrorResponse(error);
  }
}
