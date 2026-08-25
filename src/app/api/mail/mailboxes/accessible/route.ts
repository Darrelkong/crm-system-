export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor, type MailRouteActorResolver } from "@/lib/mail/api-helpers";
import { mailErrorResponse } from "@/lib/mail/errors";
import { listAccessibleMailboxes } from "@/lib/mail/mail-read-mailbox-service";

export type AccessibleMailboxesRouteDeps = {
  requireMailActor: MailRouteActorResolver;
};

const defaultDeps: AccessibleMailboxesRouteDeps = {
  requireMailActor,
};

export async function handleGetAccessibleMailboxes(
  request: Request,
  deps: AccessibleMailboxesRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const items = await listAccessibleMailboxes(db, actor);
    return Response.json({ items });
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleGetAccessibleMailboxes(request);
}
