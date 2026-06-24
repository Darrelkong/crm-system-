export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import {
  listNotificationsForUser,
} from "@/lib/notifications/queries";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const db = getDb();
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 50;

    const items = await listNotificationsForUser(db, user.id, {
      unreadOnly,
      limit: Number.isFinite(limit) ? limit : 50,
    });

    return Response.json({ items });
  } catch (error) {
    return authErrorResponse(error);
  }
}
