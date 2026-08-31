import {
  dispatchCloudflareEmailServiceRestVerificationSend,
  type CloudflareEmailServiceRestVerificationTransportConfig,
} from "@/lib/mail/cloudflare-email-service-rest-verification-transport";
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
import {
  classifySafeError,
  logVerificationDeliveryStage,
} from "@/lib/mail/notification-verification-delivery-observability";

export const VERIFICATION_PRE_PROVIDER_FAILURE_CODE =
  "verification_pre_provider_failed" as const;

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
  config: CloudflareEmailServiceRestVerificationTransportConfig,
): NotificationVerificationChallengeSink {
  return {
    async deliverChallenge(input): Promise<NotificationVerificationChallengeDeliveryResult> {
      const observability = input?.observability;
      if (observability) {
        logVerificationDeliveryStage(
          observability,
          "EMAIL_CONTENT_BUILD_STARTED",
        );
      }
      let content: ReturnType<typeof buildNotificationVerificationEmailContent>;
      try {
        content = buildNotificationVerificationEmailContent({
          targetEmail: input.targetEmail,
          verificationCode: input.token,
          expiresAt: input.expiresAt,
        });
      } catch (error) {
        if (observability) {
          logVerificationDeliveryStage(
            observability,
            "EMAIL_CONTENT_BUILD_STARTED",
            { errorCategory: classifySafeError(error) },
          );
        }
        throw new NotificationVerificationChallengeDeliveryError(
          "Verification email content could not be built",
          {
            permanent: true,
            errorCode: VERIFICATION_PRE_PROVIDER_FAILURE_CODE,
          },
        );
      }
      if (observability) {
        logVerificationDeliveryStage(
          observability,
          "EMAIL_CONTENT_BUILT",
        );
      }
      const result = await dispatchCloudflareEmailServiceRestVerificationSend(
        config,
        {
          to: content.to,
          subject: content.subject,
          text: content.text,
          observability,
        },
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
  restConfig?: CloudflareEmailServiceRestVerificationTransportConfig | null;
  overrideSink?: NotificationVerificationChallengeSink;
}): {
  sink: NotificationVerificationChallengeSink;
  transportEnabled: boolean;
} {
  if (input?.overrideSink) {
    return { sink: input.overrideSink, transportEnabled: true };
  }

  const transportEnabled = isMailNotificationVerificationTransportEnabled();
  if (!transportEnabled || !input?.restConfig) {
    return {
      sink: noopNotificationVerificationChallengeSink,
      transportEnabled: false,
    };
  }

  return {
    sink: createEmailNotificationVerificationChallengeSink(input.restConfig),
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
