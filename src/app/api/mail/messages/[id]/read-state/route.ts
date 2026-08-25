export const dynamic = "force-dynamic";

import {
  parseJsonRecord,
  requireMailActor,
  type MailRouteActorResolver,
} from "@/lib/mail/api-helpers";
import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseOptionalMessageReadFolder,
  parseReadStatePatch,
  parseRequiredMessageId,
} from "@/lib/mail/mail-read-api-parsing";
import { updateMessageReadState } from "@/lib/mail/mail-read-state-service";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";
import { authErrorResponse, AuthError } from "@/lib/permissions/auth";

export type MailMessageReadStateRouteDeps = {
  requireMailActor: MailRouteActorResolver;
};

const defaultDeps: MailMessageReadStateRouteDeps = {
  requireMailActor,
};

type RouteContext = { params: Promise<{ id: string }> };

export async function handlePatchMailMessageReadState(
  request: Request,
  messageId: string,
  deps: MailMessageReadStateRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
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

    const patch = parseReadStatePatch(parseJsonRecord(bodyResult.value));
    const normalizedMessageId = parseRequiredMessageId(messageId);
    const searchParams = new URL(request.url).searchParams;
    const folder = parseOptionalMessageReadFolder(searchParams);
    const item = await updateMessageReadState(
      db,
      actor,
      normalizedMessageId,
      patch,
      folder ? { folder } : undefined,
    );
    return Response.json({ item });
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return handlePatchMailMessageReadState(request, id);
}
