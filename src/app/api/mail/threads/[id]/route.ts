export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor, type MailRouteActorResolver } from "@/lib/mail/api-helpers";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseRequiredMailboxId,
  parseRequiredThreadId,
} from "@/lib/mail/mail-read-api-parsing";
import { getThreadMessages } from "@/lib/mail/mail-thread-service";

export type MailThreadRouteDeps = {
  requireMailActor: MailRouteActorResolver;
};

const defaultDeps: MailThreadRouteDeps = {
  requireMailActor,
};

type RouteContext = { params: Promise<{ id: string }> };

export async function handleGetMailThread(
  request: Request,
  threadId: string,
  deps: MailThreadRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const normalizedThreadId = parseRequiredThreadId(threadId);
    const searchParams = new URL(request.url).searchParams;
    const mailboxId = parseRequiredMailboxId(searchParams);
    const result = await getThreadMessages(db, actor, normalizedThreadId, mailboxId);
    return Response.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return handleGetMailThread(request, id);
}
