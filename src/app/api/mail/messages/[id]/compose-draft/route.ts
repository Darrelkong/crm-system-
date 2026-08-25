export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseJsonRecord,
  requireMailActor,
  type MailRouteActorResolver,
} from "@/lib/mail/api-helpers";
import { createSeededComposeDraft } from "@/lib/mail/compose-draft-seed-service";
import { parseComposeDraftSeedRequest } from "@/lib/mail/compose-draft-seed-parsing";
import { parseRequiredMessageId } from "@/lib/mail/mail-read-api-parsing";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

type RouteContext = { params: Promise<{ id: string }> };

export type ComposeDraftSeedRouteDeps = {
  requireMailActor: MailRouteActorResolver;
};

const defaultDeps: ComposeDraftSeedRouteDeps = {
  requireMailActor,
};

export async function handlePostComposeDraftSeed(
  request: Request,
  messageId: string,
  deps: ComposeDraftSeedRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const normalizedMessageId = parseRequiredMessageId(messageId);
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

    const seedRequest = parseComposeDraftSeedRequest(
      parseJsonRecord(bodyResult.value),
    );
    const item = await createSeededComposeDraft(db, actor, {
      sourceMessageId: normalizedMessageId,
      mode: seedRequest.mode,
      folder: seedRequest.folder,
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return handlePostComposeDraftSeed(request, id);
}
