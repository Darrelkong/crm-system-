import {
  dispatchCloudflareEmailSendWithTimeout,
  type CloudflareEmailSendBinding,
} from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import { buildNotificationVerificationEmailContent } from "@/lib/mail/notification-verification-email";
import {
  isMailNotificationVerificationTransportEnabled,
  type MailNotificationVerificationTransportDeliveryStatus,
} from "@/lib/mail/notification-verification-transport";
import {
  noopNotificationVerificationChallengeSink,
  type NotificationVerificationChallengeDeliveryResult,
  type NotificationVerificationChallengeSink,
} from "@/lib/mail/notification-verification-challenge-sink";

/** Raised when challenge transport delivery fails; must not be treated as policy rejection. */
export class NotificationVerificationChallengeDeliveryError extends Error {
  override readonly name = "NotificationVerificationChallengeDeliveryError";

  readonly permanent: boolean;
  readonly errorCode?: string;

  constructor(
    message = "Verification challenge delivery failed",
    options?: ErrorOptions & { permanent?: boolean; errorCode?: string },
  ) {
    super(message, options);
    this.permanent = options?.permanent ?? false;
    this.errorCode = options?.errorCode;
  }
}

/**
 * Raised when provider outcome cannot be determined safely.
 * Must never be auto-retried — email may already have been accepted.
 */
export class NotificationVerificationChallengeDeliveryAmbiguousError extends Error {
  override readonly name =
    "NotificationVerificationChallengeDeliveryAmbiguousError";

  constructor(message = "Verification challenge delivery outcome unknown") {
    super(message);
  }
}

export function isVerificationChallengeDeliveryFailure(
  error: unknown,
): error is NotificationVerificationChallengeDeliveryError {
  return error instanceof NotificationVerificationChallengeDeliveryError;
}

export function isVerificationChallengeDeliveryAmbiguous(
  error: unknown,
): error is NotificationVerificationChallengeDeliveryAmbiguousError {
  return error instanceof NotificationVerificationChallengeDeliveryAmbiguousError;
}

export function createEmailNotificationVerificationChallengeSink(
  emailBinding: CloudflareEmailSendBinding,
  options?: { timeoutMs?: number },
): NotificationVerificationChallengeSink {
  return {
    async deliverChallenge(input): Promise<NotificationVerificationChallengeDeliveryResult> {
      const content = buildNotificationVerificationEmailContent({
        targetEmail: input.targetEmail,
        verificationCode: input.token,
        expiresAt: input.expiresAt,
      });
      const result = await dispatchCloudflareEmailSendWithTimeout(
        emailBinding,
        {
          to: content.to,
          from: content.from,
          subject: content.subject,
          text: content.text,
        },
        { timeoutMs: options?.timeoutMs },
      );

      if (result.outcome === "accepted") {
        return { providerRequestId: result.providerRequestId };
      }
      if (result.outcome === "ambiguous") {
        throw new NotificationVerificationChallengeDeliveryAmbiguousError();
      }
      if (result.outcome === "permanent_failure") {
        throw new NotificationVerificationChallengeDeliveryError(
          result.errorMessage ?? "Verification challenge delivery failed",
          {
            permanent: true,
            errorCode: result.errorCode,
          },
        );
      }
      throw new NotificationVerificationChallengeDeliveryError(
        result.errorMessage ?? "Verification challenge delivery failed",
        {
          permanent: false,
          errorCode: result.errorCode,
        },
      );
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
