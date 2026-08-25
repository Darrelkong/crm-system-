export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  assertNotificationProofRunResponseHasNoSecrets,
  listNotificationProofRunsForAdmin,
} from "@/lib/mail/notification-proof-list-service";

export async function GET(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
    const items = await listNotificationProofRunsForAdmin(db, actor);
    const payload = { items };
    assertNotificationProofRunResponseHasNoSecrets(payload);
    return Response.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}
