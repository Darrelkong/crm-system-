export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { getLatestPublishedAnnouncementForUser } from "@/lib/announcements/service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const db = getDb();
    const announcement = await getLatestPublishedAnnouncementForUser(db, user);
    return Response.json({ announcement });
  } catch (error) {
    return authErrorResponse(error);
  }
}
