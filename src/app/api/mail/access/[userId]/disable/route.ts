export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { disableMailAccess } from "@/lib/mail/mail-access-service";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { userId } = await context.params;
    const item = await disableMailAccess(db, actor, userId);
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
