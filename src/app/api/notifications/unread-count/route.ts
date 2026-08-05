export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import {
  getPendingActionCount,
  getUnreadNotificationCount,
  getWorkItemsAttentionCount,
} from "@/lib/notifications/queries";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const db = getDb();
    const [unreadCount, pendingCount, attentionCount] = await Promise.all([
      getUnreadNotificationCount(db, user.id),
      getPendingActionCount(db, user.id),
      getWorkItemsAttentionCount(db, user.id),
    ]);
    return Response.json({ unreadCount, pendingCount, attentionCount });
  } catch (error) {
    return authErrorResponse(error);
  }
}
