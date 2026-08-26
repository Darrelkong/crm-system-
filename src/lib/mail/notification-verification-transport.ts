/**
 * Dedicated verification challenge transport — isolated from general notification outbox.
 * Default disabled. Does not read MAIL_NOTIFICATION_TRANSPORT_ENABLED.
 */
export const MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR =
  "MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE" as const;

export const MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODES = [
  "disabled",
  "production",
] as const;

export type MailNotificationVerificationTransportMode =
  (typeof MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODES)[number];

export type MailNotificationVerificationTransportDeliveryStatus =
  | "transport_disabled"
  | "queued"
  | "sent"
  | "delivery_failed";

export function readMailNotificationVerificationTransportMode(
  env: Record<string, string | undefined> = process.env,
): MailNotificationVerificationTransportMode {
  const raw = env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR]
    ?.trim()
    .toLowerCase();
  if (raw === "production") {
    return "production";
  }
  return "disabled";
}

export function isMailNotificationVerificationTransportEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return readMailNotificationVerificationTransportMode(env) === "production";
}
