export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseJsonRecord,
  readStringField,
  requireMailActor,
} from "@/lib/mail/api-helpers";
import { revokeNotificationIdentityForSecurity } from "@/lib/mail/notification-identity-service";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const bodyResult = await readLimitedJsonBody(
      request,
      MAIL_API_MAX_JSON_BYTES,
    );
    const body = bodyResult.ok ? parseJsonRecord(bodyResult.value) : {};
    const reason = readStringField(body, "reason");

    const item = await revokeNotificationIdentityForSecurity(db, actor, {
      identityId: id,
      reason,
    });
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
