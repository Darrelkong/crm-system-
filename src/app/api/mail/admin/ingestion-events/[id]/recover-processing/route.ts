export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { recoverExpiredProcessingIngestionEvent } from "@/lib/mail/ingestion-processing-recovery-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const result = await recoverExpiredProcessingIngestionEvent(db, actor, {
      ingestionEventId: id,
    });
    return Response.json({ item: result });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
