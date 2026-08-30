import {
  NOTIFICATION_VERIFICATION_CODE_LENGTH,
  computeVerificationResendCooldownSeconds,
  normalizeVerificationCodeInput,
  type NotificationVerificationFailureReason,
} from "@/lib/mail/notification-verification-challenge-policy";

type TranslateFn = (
  key: string,
  params?: Record<string, string>,
) => string;

export type NotificationVerificationErrorMetadata = {
  verificationReason?: NotificationVerificationFailureReason;
  remainingAttempts?: number;
  retryAfterSeconds?: number;
};

export function normalizeVerificationCodeFieldValue(value: string): string {
  return normalizeVerificationCodeInput(value).slice(
    0,
    NOTIFICATION_VERIFICATION_CODE_LENGTH,
  );
}

export function resolveNotificationVerificationErrorMessage(
  t: TranslateFn,
  metadata?: NotificationVerificationErrorMetadata,
): string | null {
  const reason = metadata?.verificationReason;
  if (!reason) {
    return null;
  }

  switch (reason) {
    case "invalid_code":
      if (metadata.remainingAttempts === 2) {
        return t("mail.adminCenter.notificationIdentity.verifyWrongTwoRemaining");
      }
      if (metadata.remainingAttempts === 1) {
        return t("mail.adminCenter.notificationIdentity.verifyWrongOneRemaining");
      }
      return t("mail.adminCenter.notificationIdentity.verifyWrongGeneric");
    case "expired":
      return t("mail.adminCenter.notificationIdentity.verifyExpired");
    case "locked":
      return t("mail.adminCenter.notificationIdentity.verifyLocked");
    case "resend_cooldown":
      return t("mail.adminCenter.notificationIdentity.verifyResendCooldown", {
        seconds: String(metadata.retryAfterSeconds ?? 0),
      });
    case "missing_challenge":
      return t("mail.adminCenter.notificationIdentity.verifyLocked");
    default:
      return null;
  }
}

export function formatVerificationResendActionLabel(
  t: TranslateFn,
  cooldownSeconds: number,
): string {
  if (cooldownSeconds > 0) {
    return t("mail.adminCenter.notificationIdentity.verifyResendCountdown", {
      seconds: String(cooldownSeconds),
    });
  }
  return t("mail.adminCenter.access.targetNotification.sendAction");
}

export function computePendingVerificationResendCooldownSeconds(
  verificationRequestedAt: string | null,
  nowMs = Date.now(),
): number {
  return computeVerificationResendCooldownSeconds(
    verificationRequestedAt,
    nowMs,
  );
}

export function parseNotificationVerificationErrorMetadata(
  metadata?: Record<string, unknown>,
): NotificationVerificationErrorMetadata {
  const verificationReason = metadata?.verificationReason;
  const remainingAttempts = metadata?.remainingAttempts;
  const retryAfterSeconds = metadata?.retryAfterSeconds;
  return {
    verificationReason:
      typeof verificationReason === "string"
        ? (verificationReason as NotificationVerificationFailureReason)
        : undefined,
    remainingAttempts:
      typeof remainingAttempts === "number" ? remainingAttempts : undefined,
    retryAfterSeconds:
      typeof retryAfterSeconds === "number" ? retryAfterSeconds : undefined,
  };
}

export const VERIFICATION_CODE_INPUT_PROPS = {
  maxLength: NOTIFICATION_VERIFICATION_CODE_LENGTH,
  autoComplete: "one-time-code",
  autoCapitalize: "characters",
  spellCheck: false,
  inputMode: "text" as const,
};
