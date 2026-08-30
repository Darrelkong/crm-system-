export const NOTIFICATION_VERIFICATION_CODE_LENGTH = 8 as const;
export const NOTIFICATION_VERIFICATION_MAX_ATTEMPTS = 3 as const;
export const NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS = 60_000 as const;
export const NOTIFICATION_VERIFICATION_EXPIRY_MS = 300_000 as const;

export const NOTIFICATION_VERIFICATION_CODE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const NOTIFICATION_VERIFICATION_CODE_PATTERN = /^[A-Z0-9]{8}$/;

export type NotificationVerificationFailureReason =
  | "invalid_code"
  | "expired"
  | "locked"
  | "missing_challenge"
  | "resend_cooldown";

export function verificationExpiresAt(fromMs = Date.now()): string {
  return new Date(fromMs + NOTIFICATION_VERIFICATION_EXPIRY_MS).toISOString();
}

export function isVerificationExpired(
  expiresAt: string | null,
  nowMs = Date.now(),
): boolean {
  if (!expiresAt) return true;
  return Date.parse(expiresAt) <= nowMs;
}

export function normalizeVerificationCodeInput(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function isValidVerificationCodeFormat(code: string): boolean {
  return (
    NOTIFICATION_VERIFICATION_CODE_PATTERN.test(code) &&
    /[A-Z]/.test(code) &&
    /[0-9]/.test(code)
  );
}

export function remainingVerificationAttempts(attemptCount: number): number {
  return Math.max(
    0,
    NOTIFICATION_VERIFICATION_MAX_ATTEMPTS - Math.max(0, attemptCount),
  );
}

export function isVerificationChallengeLocked(attemptCount: number): boolean {
  return attemptCount >= NOTIFICATION_VERIFICATION_MAX_ATTEMPTS;
}

export function computeVerificationResendCooldownSeconds(
  verificationRequestedAt: string | null,
  nowMs = Date.now(),
): number {
  if (!verificationRequestedAt) {
    return 0;
  }
  const elapsedMs = nowMs - Date.parse(verificationRequestedAt);
  if (elapsedMs >= NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS) {
    return 0;
  }
  return Math.ceil(
    (NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS - elapsedMs) / 1000,
  );
}

export function assertVerificationResendAllowed(
  verificationRequestedAt: string | null,
  nowMs = Date.now(),
): { retryAfterSeconds: number } | null {
  const retryAfterSeconds = computeVerificationResendCooldownSeconds(
    verificationRequestedAt,
    nowMs,
  );
  if (retryAfterSeconds <= 0) {
    return null;
  }
  return { retryAfterSeconds };
}
