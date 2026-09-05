export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor, type MailRouteActorResolver } from "@/lib/mail/api-helpers";
import { MailServiceError, mailErrorResponse } from "@/lib/mail/errors";
import {
  parseOptionalCursor,
  parseOptionalMailSearch,
  parseOptionalMailboxScope,
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
    const scope = parseOptionalMailboxScope(searchParams);
    if (scope === "all" && searchParams.has("mailboxId")) {
      throw MailServiceError.validation(
        "mailboxId cannot be used with scope=all",
      );
    }
    const mailboxId =
      scope === "single" ? parseRequiredMailboxId(searchParams) : null;
    const folder = parseRequiredMessageListFolder(searchParams);
    const limit = parseOptionalMessageListLimit(searchParams);
    const cursor = parseOptionalCursor(searchParams);
    const search = parseOptionalMailSearch(searchParams);

    const page = await listAccessibleMessages(db, actor, {
      scope,
      mailboxId,
      folder,
      limit,
      cursor,
      search,
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
