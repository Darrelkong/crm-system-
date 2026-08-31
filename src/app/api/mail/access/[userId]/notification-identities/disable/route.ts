export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { disableActiveNotificationIdentity } from "@/lib/mail/notification-identity-service";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { userId } = await context.params;
    await disableActiveNotificationIdentity(db, actor, userId);
    return Response.json({ ok: true });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
