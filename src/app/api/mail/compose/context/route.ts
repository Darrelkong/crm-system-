export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { listComposeContextOptions } from "@/lib/mail/compose-context-service";

export async function GET(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
    const items = await listComposeContextOptions(db, actor);
    return Response.json({ items });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
