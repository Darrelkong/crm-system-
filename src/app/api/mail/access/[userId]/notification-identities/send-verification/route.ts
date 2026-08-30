export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import {
  requireMailActor,
  type MailRouteActorResolver,
} from "@/lib/mail/api-helpers";
import { sendNotificationIdentityVerificationChallenge } from "@/lib/mail/notification-identity-service";
import type { NotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import { getLocalVerificationChallengeSinkForHarness } from "@/lib/mail/notification-verification-local-test-harness";
import { isNotificationVerificationProofTokenApiAllowed } from "@/lib/mail/notification-verification-proof-guard";

type RouteContext = { params: Promise<{ userId: string }> };

export type SendVerificationRouteDeps = {
  requireMailActor: MailRouteActorResolver;
  resolveChallengeSink?: () => NotificationVerificationChallengeSink | undefined;
  nowMs?: () => number;
};

const defaultDeps: SendVerificationRouteDeps = {
  requireMailActor,
  resolveChallengeSink: () =>
    isNotificationVerificationProofTokenApiAllowed()
      ? getLocalVerificationChallengeSinkForHarness()
      : undefined,
};

export async function handlePostSendVerification(
  request: Request,
  userId: string,
  deps: SendVerificationRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const challengeSink = deps.resolveChallengeSink?.();
    const result = await sendNotificationIdentityVerificationChallenge(
      db,
      actor,
      userId,
      {
        challengeSink,
        nowMs: deps.nowMs?.(),
      },
    );
    return Response.json(result, { status: 200 });
  } catch (error) {
    return mailErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { userId } = await context.params;
  return handlePostSendVerification(request, userId);
}
