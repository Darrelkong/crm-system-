import { MailServiceError } from "@/lib/mail/errors";
import {
  createCapturingNotificationVerificationChallengeSink,
  type NotificationVerificationChallengeSink,
} from "@/lib/mail/notification-verification-challenge-sink";
import { assertNotificationVerificationProofTokenApiAllowed } from "@/lib/mail/notification-verification-proof-guard";

let localHarness:
  | ReturnType<typeof createCapturingNotificationVerificationChallengeSink>
  | null = null;

/** LOCAL/TEST ONLY — never available in deployed Workers. */
export function getLocalVerificationChallengeSinkForHarness(): NotificationVerificationChallengeSink {
  assertNotificationVerificationProofTokenApiAllowed();
  if (!localHarness) {
    localHarness = createCapturingNotificationVerificationChallengeSink();
  }
  return localHarness.sink;
}

/** LOCAL/TEST ONLY — read the latest delivered challenge for browser/integration harnesses. */
export function readLocalVerificationChallengeForHarness(): {
  token: string;
  destinationEmail: string;
  expiresAt: string;
} {
  assertNotificationVerificationProofTokenApiAllowed();
  if (!localHarness) {
    throw MailServiceError.notFound("No local verification challenge captured");
  }
  const latest = localHarness.deliveries.at(-1);
  if (!latest) {
    throw MailServiceError.notFound("No local verification challenge captured");
  }
  return {
    token: latest.token,
    destinationEmail: latest.targetEmail,
    expiresAt: latest.expiresAt,
  };
}

export function resetLocalVerificationChallengeHarnessForTests(): void {
  localHarness = null;
}
