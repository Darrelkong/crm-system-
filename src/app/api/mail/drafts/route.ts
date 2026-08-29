export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseJsonRecord,
  readStringField,
  requireMailActor,
} from "@/lib/mail/api-helpers";
import { createDraft, listDrafts } from "@/lib/mail/draft-service";
import { parseDraftRecipientsField } from "@/lib/mail/draft-api-parsing";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

export async function GET(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
    const mailboxId = new URL(request.url).searchParams.get("mailboxId")?.trim();
    const items = await listDrafts(
      db,
      actor,
      mailboxId ? { mailboxId } : undefined,
    );
    return Response.json({ items });
  } catch (error) {
    return mailErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
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
    const senderIdentityId = readStringField(body, "senderIdentityId");
    const mailboxId = readStringField(body, "mailboxId");
    if (!senderIdentityId || !mailboxId) {
      return Response.json(
        {
          error: "senderIdentityId and mailboxId are required",
          errorCode: "VALIDATION",
        },
        { status: 400 },
      );
    }

    const result = await createDraft(db, actor, {
      senderIdentityId,
      mailboxId,
      subject: readStringField(body, "subject"),
      bodyText: readStringField(body, "bodyText"),
      bodyHtml: readStringField(body, "bodyHtml"),
      recipients: parseDraftRecipientsField(body.recipients),
      allowEmptyShell: body.allowEmptyShell === true,
    });

    if (!result.created) {
      return Response.json({ created: false, item: null });
    }
    return Response.json({ created: true, item: result.item }, { status: 201 });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
