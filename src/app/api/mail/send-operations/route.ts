export const dynamic = "force-dynamic";

import { requireMailActor } from "@/lib/mail/api-helpers";
import { mailErrorResponse } from "@/lib/mail/errors";
import { listOutboxItems } from "@/lib/mail/outbox-service";

export async function GET(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
    const mailboxId = new URL(request.url).searchParams.get("mailboxId");
    const items = await listOutboxItems(db, actor, { mailboxId });
    return Response.json({ items });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
