export const dynamic = "force-dynamic";

import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";
import {
  parseJsonRecord,
  requireMailActor,
} from "@/lib/mail/api-helpers";
import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { removeDraftAttachment } from "@/lib/mail/draft-attachment-service";
import { mailErrorResponse } from "@/lib/mail/errors";

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id: draftId, attachmentId } = await context.params;

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
    const expectedAutosaveVersion = body.expectedAutosaveVersion;
    if (typeof expectedAutosaveVersion !== "number") {
      return Response.json(
        {
          error: "expectedAutosaveVersion is required",
          errorCode: "VALIDATION",
        },
        { status: 400 },
      );
    }

    const item = await removeDraftAttachment(db, actor, {
      draftId,
      attachmentId,
      expectedAutosaveVersion,
    });

    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
