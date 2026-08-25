export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseJsonRecord,
  readStringField,
  requireMailActor,
} from "@/lib/mail/api-helpers";
import {
  grantMailboxMember,
  listMailboxMembers,
} from "@/lib/mail/mailbox-member-service";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const items = await listMailboxMembers(db, actor, id);
    return Response.json({ items });
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
    const targetUserId = readStringField(body, "targetUserId");
    if (!targetUserId) {
      return Response.json(
        { error: "targetUserId is required", errorCode: "VALIDATION" },
        { status: 400 },
      );
    }

    const item = await grantMailboxMember(db, actor, {
      mailboxId: id,
      targetUserId,
      canRead: body.canRead === true,
      canReply: body.canReply === true,
      canSend: body.canSend === true,
      canAssign: body.canAssign === true,
      canManageProcessing: body.canManageProcessing === true,
      canAddInternalNote: body.canAddInternalNote === true,
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
