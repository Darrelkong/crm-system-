export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseJsonRecord,
  readStringField,
  requireMailActor,
} from "@/lib/mail/api-helpers";
import {
  createMailbox,
  listMailboxesForAdmin,
} from "@/lib/mail/mailbox-service";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

export async function GET(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
    const items = await listMailboxesForAdmin(db, actor);
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
    const address = readStringField(body, "address");
    const displayName = readStringField(body, "displayName");
    const mailboxType = readStringField(body, "mailboxType");

    if (!address) {
      return Response.json(
        { error: "address is required", errorCode: "VALIDATION" },
        { status: 400 },
      );
    }
    if (mailboxType !== "personal" && mailboxType !== "shared") {
      return Response.json(
        { error: "mailboxType must be personal or shared", errorCode: "VALIDATION" },
        { status: 400 },
      );
    }

    const item = await createMailbox(db, actor, {
      address,
      displayName,
      mailboxType,
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
