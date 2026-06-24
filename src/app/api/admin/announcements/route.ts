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
  createAnnouncement,
  listAllAnnouncementsForAdmin,
} from "@/lib/announcements/service";

export async function GET(request: Request) {
  try {
    await requireAnnouncementManageAdmin(request);
    const db = getDb();
    const items = await listAllAnnouncementsForAdmin(db);
    return Response.json({ items });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAnnouncementManageAdmin(request);
    const db = getDb();
    const { ipAddress, userAgent } = getRequestMeta(request);
    const body = (await request.json()) as {
      title?: string;
      content?: string;
      audience?: string;
    };

    const audience = body.audience as AnnouncementAudienceOption | undefined;
    if (!audience || !(ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(audience)) {
      return Response.json(
        { error: "audience 必须为 all / admin / staff" },
        { status: 400 },
      );
    }

    const item = await createAnnouncement(db, actor, {
      title: body.title ?? "",
      content: body.content ?? "",
      audience,
    });

    await writeAuditLog({
      userId: actor.id,
      action: ANNOUNCEMENT_AUDIT_ACTIONS.created,
      entityType: "announcement",
      entityId: item.id,
      ipAddress,
      userAgent,
      metadata: { title: item.title, audience: item.audience },
    });

    return Response.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof AnnouncementError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
