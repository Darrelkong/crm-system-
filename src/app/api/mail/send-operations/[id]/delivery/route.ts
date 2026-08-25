export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { getSendOperationDeliveryLifecycle } from "@/lib/mail/send-operation-delivery-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const item = await getSendOperationDeliveryLifecycle(db, actor, id);
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
