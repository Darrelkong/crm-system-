import type { CloudflareEmailSendBinding } from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import { buildNotificationVerificationEmailContent } from "@/lib/mail/notification-verification-email";
import {
  isMailNotificationVerificationTransportEnabled,
  type MailNotificationVerificationTransportDeliveryStatus,
} from "@/lib/mail/notification-verification-transport";
import {
  noopNotificationVerificationChallengeSink,
  type NotificationVerificationChallengeSink,
} from "@/lib/mail/notification-verification-challenge-sink";

/** Raised when challenge transport delivery fails; must not be treated as policy rejection. */
export class NotificationVerificationChallengeDeliveryError extends Error {
  override readonly name = "NotificationVerificationChallengeDeliveryError";

  constructor(message = "Verification challenge delivery failed", options?: ErrorOptions) {
    super(message, options);
  }
}

export function isVerificationChallengeDeliveryFailure(
  error: unknown,
): error is NotificationVerificationChallengeDeliveryError {
  return error instanceof NotificationVerificationChallengeDeliveryError;
}

export function createEmailNotificationVerificationChallengeSink(
  emailBinding: CloudflareEmailSendBinding,
): NotificationVerificationChallengeSink {
  return {
    async deliverChallenge(input) {
      const content = buildNotificationVerificationEmailContent({
        targetEmail: input.targetEmail,
        verificationCode: input.token,
        expiresAt: input.expiresAt,
      });
      await emailBinding.send({
        to: content.to,
        from: content.from,
        subject: content.subject,
        text: content.text,
      });
    },
  };
}

export function resolveNotificationVerificationChallengeSink(input?: {
  emailBinding?: CloudflareEmailSendBinding | null;
  overrideSink?: NotificationVerificationChallengeSink;
}): {
  sink: NotificationVerificationChallengeSink;
  transportEnabled: boolean;
} {
  if (input?.overrideSink) {
    return { sink: input.overrideSink, transportEnabled: true };
  }

  const transportEnabled = isMailNotificationVerificationTransportEnabled();
  if (!transportEnabled || !input?.emailBinding) {
    return {
      sink: noopNotificationVerificationChallengeSink,
      transportEnabled: false,
    };
  }

  return {
    sink: createEmailNotificationVerificationChallengeSink(input.emailBinding),
    transportEnabled: true,
  };
}

export function resolveVerificationChallengeDeliveryStatus(input: {
  transportEnabled: boolean;
  delivered: boolean;
  queued?: boolean;
}): MailNotificationVerificationTransportDeliveryStatus {
  if (!input.transportEnabled) {
    return "transport_disabled";
  }
  if (input.queued) {
    return "queued";
  }
  return input.delivered ? "sent" : "delivery_failed";
}
