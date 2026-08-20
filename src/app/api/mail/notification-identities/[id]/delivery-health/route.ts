export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import type { MailNotificationDeliveryHealth } from "../../../../../../../drizzle/schema/mail-notification-identities";
import { MAIL_NOTIFICATION_DELIVERY_HEALTH } from "../../../../../../../drizzle/schema/mail-notification-identities";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseJsonRecord,
  readStringField,
  requireMailActor,
} from "@/lib/mail/api-helpers";
import { updateNotificationDeliveryHealth } from "@/lib/mail/notification-identity-service";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

type RouteContext = { params: Promise<{ id: string }> };

function isDeliveryHealth(value: string): value is MailNotificationDeliveryHealth {
  return (MAIL_NOTIFICATION_DELIVERY_HEALTH as readonly string[]).includes(value);
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const bodyResult = await readLimitedJsonBody(
      request,
      MAIL_API_MAX_JSON_BYTES,
    );
    if (!bodyResult.ok) {
      return Response.json(
        { error: bodyResult.message, errorCode: bodyResult.errorCode },
        { status: bodyResult.httpStatus },
      );
    }
    const body = parseJsonRecord(bodyResult.value);
    const deliveryHealthRaw = readStringField(body, "deliveryHealth");
    if (!deliveryHealthRaw || !isDeliveryHealth(deliveryHealthRaw)) {
      return Response.json(
        { error: "deliveryHealth is required", errorCode: "VALIDATION" },
        { status: 400 },
      );
    }

    const item = await updateNotificationDeliveryHealth(db, actor, {
      identityId: id,
      deliveryHealth: deliveryHealthRaw,
      lastDeliveryStatus: readStringField(body, "lastDeliveryStatus"),
    });
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
