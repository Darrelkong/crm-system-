export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { getUnreadNotificationCount } from "@/lib/notifications/queries";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const db = getDb();
    const unreadCount = await getUnreadNotificationCount(db, user.id);
    return Response.json({ unreadCount });
  } catch (error) {
    return authErrorResponse(error);
  }
}
