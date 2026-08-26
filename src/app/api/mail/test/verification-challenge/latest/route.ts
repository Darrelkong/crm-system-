export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { readLocalVerificationChallengeForHarness } from "@/lib/mail/notification-verification-local-test-harness";

/** LOCAL/TEST ONLY — guarded identically to self proof-token API. */
export async function GET(request: Request) {
  try {
    await requireMailActor(request);
    const challenge = readLocalVerificationChallengeForHarness();
    return Response.json(
      {
        destinationEmail: challenge.destinationEmail,
        expiresAt: challenge.expiresAt,
        verificationToken: challenge.token,
      },
      { status: 200 },
    );
  } catch (error) {
    return mailErrorResponse(error);
  }
}
