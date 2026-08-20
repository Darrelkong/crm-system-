import { createHash, randomBytes } from "node:crypto";

const VERIFICATION_TOKEN_BYTES = 32;

/** 256 bits — cryptographically secure random token entropy. */
export const VERIFICATION_TOKEN_ENTROPY_BITS = VERIFICATION_TOKEN_BYTES * 8;

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateVerificationChallenge(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(VERIFICATION_TOKEN_BYTES).toString("hex");
  return { token, tokenHash: hashVerificationToken(token) };
}

export function verificationExpiresAt(hoursFromNow = 24): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

export function isVerificationExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return Date.parse(expiresAt) <= Date.now();
}
