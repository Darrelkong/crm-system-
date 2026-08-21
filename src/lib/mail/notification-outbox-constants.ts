import type { MailNotificationType } from "../../../drizzle/schema/mail-notification-outbox";

/** V1 frozen notification processing lease — server-owned, not caller-configurable. */
export const NOTIFICATION_PROCESSING_LEASE_V1_MS = 15 * 60 * 1000;

/** Maximum transport attempts per outbox intent (including first attempt). */
export const NOTIFICATION_MAX_ATTEMPTS = 5;

/** Retry delay after temporary failure, keyed by failed attempt_number. */
export const NOTIFICATION_RETRY_DELAY_MS: Readonly<Record<number, number>> = {
  1: 15 * 60 * 1000,
  2: 60 * 60 * 1000,
  3: 4 * 60 * 60 * 1000,
  4: 12 * 60 * 60 * 1000,
};

export const NOTIFICATION_FAILURE_CODES = {
  notificationIdentityInvalid: "notification_identity_invalid",
  notificationIdentityBounced: "notification_identity_bounced",
  mailAccessDisabled: "mail_access_disabled",
  retryExhausted: "retry_exhausted",
  transportOutcomeUnknown: "transport_outcome_unknown",
  transportTemporaryFailure: "transport_temporary_failure",
  transportPermanentFailure: "transport_permanent_failure",
} as const;

export type NotificationFailureCode =
  (typeof NOTIFICATION_FAILURE_CODES)[keyof typeof NOTIFICATION_FAILURE_CODES];

export const NOTIFICATION_ATTEMPT_ERROR_CODES = {
  transportOutcomeUnknown: "transport_outcome_unknown",
} as const;

export const FAKE_NOTIFICATION_TRANSPORT_PROVIDER = "fake-notification-v1" as const;

/** Max sanitized error_message length persisted on attempts. */
export const NOTIFICATION_ERROR_MESSAGE_MAX_LENGTH = 500;

export function computeNotificationRetryAfter(
  failedAttemptNumber: number,
  fromMs: number,
): string {
  const delayMs =
    NOTIFICATION_RETRY_DELAY_MS[failedAttemptNumber] ??
    NOTIFICATION_RETRY_DELAY_MS[4]!;
  return new Date(fromMs + delayMs).toISOString();
}

export function isNotificationType(value: string): value is MailNotificationType {
  return (
    value === "new_incoming" ||
    value === "approval_returned" ||
    value === "shared_assigned" ||
    value === "important_send_failure"
  );
}
