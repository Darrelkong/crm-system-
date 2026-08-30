import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  NOTIFICATION_VERIFICATION_CODE_ALPHABET,
  NOTIFICATION_VERIFICATION_CODE_LENGTH,
  isValidVerificationCodeFormat,
  verificationExpiresAt,
} from "@/lib/mail/notification-verification-challenge-policy";
import { requireNotificationVerificationSecret } from "@/lib/mail/notification-verification-secret";

const VERIFICATION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const VERIFICATION_DIGITS = "0123456789";
const VERIFICATION_CHALLENGE_CONTEXT_VERSION = "v1";

export {
  isVerificationExpired,
  verificationExpiresAt,
} from "@/lib/mail/notification-verification-challenge-policy";

export function buildVerificationChallengeContext(identityId: string): string {
  return `mail_notification_identity_verification:${VERIFICATION_CHALLENGE_CONTEXT_VERSION}:${identityId}`;
}

function normalizeStoredVerificationToken(token: string): string {
  return token.trim().toUpperCase();
}

export function hashVerificationToken(
  token: string,
  identityId: string,
  secret?: string,
): string {
  const key = secret ?? requireNotificationVerificationSecret();
  const normalized = normalizeStoredVerificationToken(token);
  const context = buildVerificationChallengeContext(identityId);
  return createHmac("sha256", key)
    .update(`${context}\0${normalized}`, "utf8")
    .digest("hex");
}

export function verifyVerificationTokenHash(
  storedHash: string | null | undefined,
  token: string,
  identityId: string,
  secret?: string,
): boolean {
  if (!storedHash) {
    return false;
  }
  const expected = hashVerificationToken(token, identityId, secret);
  const storedBuffer = Buffer.from(storedHash, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (storedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(storedBuffer, expectedBuffer);
}

function randomAlphabetIndex(alphabet: string): number {
  const alphabetLength = alphabet.length;
  const maxUnbiased = Math.floor(256 / alphabetLength) * alphabetLength;
  while (true) {
    const byte = randomBytes(1)[0]!;
    if (byte < maxUnbiased) {
      return byte % alphabetLength;
    }
  }
}

function randomAlphabetChar(alphabet: string): string {
  return alphabet[randomAlphabetIndex(alphabet)]!;
}

function randomInt(maxExclusive: number): number {
  const maxUnbiased = Math.floor(256 / maxExclusive) * maxExclusive;
  while (true) {
    const byte = randomBytes(1)[0]!;
    if (byte < maxUnbiased) {
      return byte % maxExclusive;
    }
  }
}

function shuffleChars(chars: string[]): string[] {
  const next = [...chars];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
  }
  return next;
}

/** Generates an 8-character A-Z0-9 code with at least one letter and one digit. */
export function generateVerificationChallenge(
  identityId: string,
  nowMs = Date.now(),
): {
  token: string;
  tokenHash: string;
  expiresAt: string;
} {
  const chars = shuffleChars([
    randomAlphabetChar(VERIFICATION_LETTERS),
    randomAlphabetChar(VERIFICATION_DIGITS),
    ...Array.from({ length: NOTIFICATION_VERIFICATION_CODE_LENGTH - 2 }, () =>
      randomAlphabetChar(NOTIFICATION_VERIFICATION_CODE_ALPHABET),
    ),
  ]);
  const token = chars.join("");
  if (!isValidVerificationCodeFormat(token)) {
    throw new Error("Generated verification code failed format validation");
  }
  return {
    token,
    tokenHash: hashVerificationToken(token, identityId),
    expiresAt: verificationExpiresAt(nowMs),
  };
}
