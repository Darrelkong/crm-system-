export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor, type MailRouteActorResolver } from "@/lib/mail/api-helpers";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseOptionalMessageReadFolder,
  parseRequiredMessageId,
} from "@/lib/mail/mail-read-api-parsing";
import { getMessageDetail } from "@/lib/mail/mail-read-service";

export type MailMessageDetailRouteDeps = {
  requireMailActor: MailRouteActorResolver;
};

const defaultDeps: MailMessageDetailRouteDeps = {
  requireMailActor,
};

type RouteContext = { params: Promise<{ id: string }> };

export async function handleGetMailMessageDetail(
  request: Request,
  messageId: string,
  deps: MailMessageDetailRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const normalizedMessageId = parseRequiredMessageId(messageId);
    const searchParams = new URL(request.url).searchParams;
    const folder = parseOptionalMessageReadFolder(searchParams);
    const item = await getMessageDetail(
      db,
      actor,
      normalizedMessageId,
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

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return handleGetMailMessageDetail(request, id);
}
