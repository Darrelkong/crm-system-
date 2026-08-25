export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseJsonRecord,
  readStringField,
  requireMailActor,
} from "@/lib/mail/api-helpers";
import { getDraft, updateDraft } from "@/lib/mail/draft-service";
import {
  parseDraftCustomerAssociationPatch,
  parseDraftRecipientsField,
} from "@/lib/mail/draft-api-parsing";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const item = await getDraft(db, actor, id);
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
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
    const forbiddenProvenanceKeys = ["composeMode", "replyToMessageId"] as const;
    for (const key of forbiddenProvenanceKeys) {
      if (key in body) {
        return Response.json(
          {
            error: `${key} cannot be changed through draft update`,
            errorCode: "VALIDATION",
          },
          { status: 400 },
        );
      }
    }

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

    const item = await updateDraft(db, actor, {
      draftId: id,
      expectedAutosaveVersion,
      subject: readStringField(body, "subject"),
      bodyText: readStringField(body, "bodyText"),
      bodyHtml: readStringField(body, "bodyHtml"),
      senderIdentityId: readStringField(body, "senderIdentityId"),
      mailboxId: readStringField(body, "mailboxId"),
      recipients: parseDraftRecipientsField(body.recipients),
      customerAssociation: parseDraftCustomerAssociationPatch(body),
    });
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
