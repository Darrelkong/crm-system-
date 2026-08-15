export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { getNotificationBadgeCounts } from "@/lib/notifications/queries";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const db = getDb();
    const { unreadCount, pendingCount, attentionCount } =
      await getNotificationBadgeCounts(db, user.id);
    return Response.json({ unreadCount, pendingCount, attentionCount });
  } catch (error) {
    return authErrorResponse(error);
  }
}
