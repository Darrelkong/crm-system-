export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { issueSelfVerificationTokenForAdminProof } from "@/lib/mail/notification-identity-service";

export async function POST(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
    const result = await issueSelfVerificationTokenForAdminProof(db, actor);
    return Response.json(result, { status: 200 });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
