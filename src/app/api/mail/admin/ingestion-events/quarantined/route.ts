export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { listQuarantinedIngestionEvents } from "@/lib/mail/ingestion-quarantine-replay-service";

export async function GET(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
    const url = new URL(request.url);
    const eventKind = url.searchParams.get("eventKind");
    const items = await listQuarantinedIngestionEvents(db, actor, {
      eventKind:
        eventKind === "inbound_message" || eventKind === "delivery_event"
          ? eventKind
          : undefined,
    });
    return Response.json({ items });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
