export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { authErrorResponse } from "@/lib/permissions/auth";
import { requireAnnouncementManageAdmin } from "@/lib/permissions/announcements";
import { getDb } from "@/lib/db";
import { ANNOUNCEMENT_AUDIT_ACTIONS } from "@/lib/announcements/constants";
import {
  AnnouncementError,
  archiveAnnouncement,
} from "@/lib/announcements/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireAnnouncementManageAdmin(request);
    const { id } = await context.params;
    const db = getDb();
    const { ipAddress, userAgent } = getRequestMeta(request);

    const item = await archiveAnnouncement(db, id);

    await writeAuditLog({
      userId: actor.id,
      action: ANNOUNCEMENT_AUDIT_ACTIONS.archived,
      entityType: "announcement",
      entityId: id,
      ipAddress,
      userAgent,
      metadata: { title: item.title },
    });

    return Response.json({ item });
  } catch (error) {
    if (error instanceof AnnouncementError) {
      const status = error.message === "公告不存在" ? 404 : 400;
      return Response.json({ error: error.message }, { status });
    }
    return authErrorResponse(error);
  }
}
