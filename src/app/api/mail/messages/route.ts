export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor, type MailRouteActorResolver } from "@/lib/mail/api-helpers";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseOptionalCursor,
  parseOptionalMessageListLimit,
  parseRequiredMailboxId,
  parseRequiredMessageListFolder,
} from "@/lib/mail/mail-read-api-parsing";
import { listAccessibleMessages } from "@/lib/mail/mail-read-service";

export type MailMessagesRouteDeps = {
  requireMailActor: MailRouteActorResolver;
};

const defaultDeps: MailMessagesRouteDeps = {
  requireMailActor,
};

export async function handleGetMailMessages(
  request: Request,
  deps: MailMessagesRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const searchParams = new URL(request.url).searchParams;
    const mailboxId = parseRequiredMailboxId(searchParams);
    const folder = parseRequiredMessageListFolder(searchParams);
    const limit = parseOptionalMessageListLimit(searchParams);
    const cursor = parseOptionalCursor(searchParams);

    const page = await listAccessibleMessages(db, actor, {
      mailboxId,
      folder,
      limit,
      cursor,
    });

    return Response.json(page);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleGetMailMessages(request);
}
