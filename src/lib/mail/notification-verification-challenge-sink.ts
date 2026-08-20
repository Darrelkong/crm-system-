export type NotificationVerificationChallengeDelivery = {
  notificationIdentityId: string;
  targetEmail: string;
  token: string;
  expiresAt: string;
};

/**
 * Server-internal seam for future Notification Dispatch.
 * Plaintext token exists only transiently inside trusted server execution.
 */
export type NotificationVerificationChallengeSink = {
  deliverChallenge(
    input: NotificationVerificationChallengeDelivery,
  ): void | Promise<void>;
};

export const noopNotificationVerificationChallengeSink: NotificationVerificationChallengeSink =
  {
    deliverChallenge() {},
  };

export function createCapturingNotificationVerificationChallengeSink(): {
  sink: NotificationVerificationChallengeSink;
  deliveries: NotificationVerificationChallengeDelivery[];
  latestToken(): string | null;
} {
  const deliveries: NotificationVerificationChallengeDelivery[] = [];
  return {
    deliveries,
    sink: {
      deliverChallenge(input) {
        deliveries.push(input);
      },
    },
    latestToken() {
      return deliveries.at(-1)?.token ?? null;
    },
  };
}
