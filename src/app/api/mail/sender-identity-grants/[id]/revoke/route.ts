export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { revokeSenderIdentityGrant } from "@/lib/mail/sender-identity-grant-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const item = await revokeSenderIdentityGrant(db, actor, { grantId: id });
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
