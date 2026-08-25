export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { mailErrorResponse } from "@/lib/mail/errors";
import { buildMailSessionContext } from "@/lib/mail/mail-session-context";

export async function GET(request: Request) {
  try {
    const { user, actor } = await requireMailActor(request);
    return Response.json(buildMailSessionContext(user, actor));
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}
