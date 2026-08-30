import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Server-only HMAC key for notification identity verification OTP digests. */
export const MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR =
  "MAIL_NOTIFICATION_VERIFICATION_SECRET" as const;

export function resolveNotificationVerificationSecret(
  env: Record<string, string | undefined>,
): string | null {
  const secret = env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR]?.trim();
  return secret || null;
}

export function getNotificationVerificationSecret(): string | null {
  try {
    const { env } = getCloudflareContext();
    return resolveNotificationVerificationSecret(
      env as unknown as Record<string, string | undefined>,
    );
  } catch {
    return resolveNotificationVerificationSecret(process.env);
  }
}

export function requireNotificationVerificationSecret(): string {
  const secret = getNotificationVerificationSecret();
  if (!secret) {
    throw new Error(
      `${MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR} is not configured`,
    );
  }
  return secret;
}
