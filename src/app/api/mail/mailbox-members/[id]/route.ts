export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import { parseJsonRecord, requireMailActor } from "@/lib/mail/api-helpers";
import { updateMailboxMemberPermissions } from "@/lib/mail/mailbox-member-service";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
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
    const item = await updateMailboxMemberPermissions(db, actor, {
      memberId: id,
      canRead: body.canRead === true ? true : body.canRead === false ? false : undefined,
      canReply: body.canReply === true ? true : body.canReply === false ? false : undefined,
      canSend: body.canSend === true ? true : body.canSend === false ? false : undefined,
      canAssign: body.canAssign === true ? true : body.canAssign === false ? false : undefined,
      canManageProcessing:
        body.canManageProcessing === true
          ? true
          : body.canManageProcessing === false
            ? false
            : undefined,
      canAddInternalNote:
        body.canAddInternalNote === true
          ? true
          : body.canAddInternalNote === false
            ? false
            : undefined,
    });
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
