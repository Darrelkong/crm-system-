export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { sendNotificationIdentityVerificationChallenge } from "@/lib/mail/notification-identity-service";
import { getLocalVerificationChallengeSinkForHarness } from "@/lib/mail/notification-verification-local-test-harness";
import { isNotificationVerificationProofTokenApiAllowed } from "@/lib/mail/notification-verification-proof-guard";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { userId } = await context.params;
    const result = await sendNotificationIdentityVerificationChallenge(
      db,
      actor,
      userId,
      {
        challengeSink: isNotificationVerificationProofTokenApiAllowed()
          ? getLocalVerificationChallengeSinkForHarness()
          : undefined,
      },
    );
    return Response.json(result, { status: 200 });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
