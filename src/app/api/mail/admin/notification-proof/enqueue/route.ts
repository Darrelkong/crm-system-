export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { enqueueNotificationProofForAdmin } from "@/lib/mail/notification-proof-enqueue-service";

export async function POST(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
    const item = await enqueueNotificationProofForAdmin(db, actor);
    return Response.json({ item }, { status: item.created ? 201 : 200 });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
