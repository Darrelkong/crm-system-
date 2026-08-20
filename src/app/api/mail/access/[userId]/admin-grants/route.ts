export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import type { MailAdminPermission } from "../../../../../../../drizzle/schema/mail-admin-grants";
import { MAIL_ADMIN_PERMISSIONS } from "../../../../../../../drizzle/schema/mail-admin-grants";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseJsonRecord,
  readStringField,
  requireMailActor,
} from "@/lib/mail/api-helpers";
import {
  grantMailAdminPermission,
  listAdminGrantsForUser,
} from "@/lib/mail/mail-admin-grant-service";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

type RouteContext = { params: Promise<{ userId: string }> };

function isMailAdminPermission(value: string): value is MailAdminPermission {
  return (MAIL_ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { userId } = await context.params;
    const items = await listAdminGrantsForUser(db, actor, userId);
    return Response.json({ items });
  } catch (error) {
    return mailErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { userId } = await context.params;
    const bodyResult = await readLimitedJsonBody(
      request,
      MAIL_API_MAX_JSON_BYTES,
    );
    if (!bodyResult.ok) {
      return Response.json(
        { error: bodyResult.message, errorCode: bodyResult.errorCode },
        { status: 400 },
      );
    }
    const body = parseJsonRecord(bodyResult.value);
    const permission = readStringField(body, "permission");
    if (!permission || !isMailAdminPermission(permission)) {
      return Response.json(
        { error: "permission is required", errorCode: "VALIDATION" },
        { status: 400 },
      );
    }

    const item = await grantMailAdminPermission(db, actor, {
      targetUserId: userId,
      permission,
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
