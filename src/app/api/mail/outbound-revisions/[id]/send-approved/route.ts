export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseJsonRecord,
  readStringField,
  requireMailActor,
} from "@/lib/mail/api-helpers";
import { initiateStaffApprovedSend } from "@/lib/mail/send-operation-service";
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
    if (!bodyResult.ok) {
      return Response.json(
        { error: bodyResult.message, errorCode: bodyResult.errorCode },
        { status: bodyResult.httpStatus },
      );
    }
    const body = parseJsonRecord(bodyResult.value);
    const idempotencyKey = readStringField(body, "idempotencyKey");
    if (!idempotencyKey?.trim()) {
      return Response.json(
        { error: "idempotencyKey is required", errorCode: "VALIDATION" },
        { status: 400 },
      );
    }

    const item = await initiateStaffApprovedSend(db, actor, {
      revisionId: id,
      idempotencyKey,
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
