export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { authErrorResponse } from "@/lib/permissions/auth";
import { requireAnnouncementManageAdmin } from "@/lib/permissions/announcements";
import { getDb } from "@/lib/db";
import {
  ANNOUNCEMENT_AUDIENCES,
  type AnnouncementAudienceOption,
} from "@/lib/announcements/constants";
import { ANNOUNCEMENT_AUDIT_ACTIONS } from "@/lib/announcements/constants";
import {
  AnnouncementError,
  updateAnnouncement,
} from "@/lib/announcements/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireAnnouncementManageAdmin(request);
    const { id } = await context.params;
    const db = getDb();
    const { ipAddress, userAgent } = getRequestMeta(request);
    const body = (await request.json()) as {
      title?: string;
      content?: string;
      audience?: string;
    };

    let audience: AnnouncementAudienceOption | undefined;
    if (body.audience !== undefined) {
      if (
        !(ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(body.audience)
      ) {
        return Response.json(
          { error: "audience 必须为 all / admin / staff" },
          { status: 400 },
        );
      }
      audience = body.audience as AnnouncementAudienceOption;
    }

    const item = await updateAnnouncement(db, id, {
      title: body.title,
      content: body.content,
      audience,
    });

    await writeAuditLog({
      userId: actor.id,
      action: ANNOUNCEMENT_AUDIT_ACTIONS.updated,
      entityType: "announcement",
      entityId: id,
      ipAddress,
      userAgent,
      metadata: { title: item.title, audience: item.audience },
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
