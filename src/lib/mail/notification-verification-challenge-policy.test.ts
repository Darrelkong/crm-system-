import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  NOTIFICATION_VERIFICATION_CODE_ALPHABET,
  NOTIFICATION_VERIFICATION_CODE_LENGTH,
  NOTIFICATION_VERIFICATION_CODE_PATTERN,
  NOTIFICATION_VERIFICATION_EXPIRY_MS,
  NOTIFICATION_VERIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS,
  assertVerificationResendAllowed,
  computeVerificationResendCooldownSeconds,
  isValidVerificationCodeFormat,
  normalizeVerificationCodeInput,
  remainingVerificationAttempts,
  verificationExpiresAt,
} from "@/lib/mail/notification-verification-challenge-policy";

describe("notification verification challenge policy", () => {
  it("uses a 5-minute expiry window", () => {
    const now = Date.parse("2026-08-30T08:00:00.000Z");
    assert.equal(
      verificationExpiresAt(now),
      "2026-08-30T08:05:00.000Z",
    );
    assert.equal(NOTIFICATION_VERIFICATION_EXPIRY_MS, 300_000);
  });

  it("enforces a 60-second resend cooldown server-side", () => {
    const requestedAt = "2026-08-30T08:00:00.000Z";
    assert.deepEqual(
      assertVerificationResendAllowed(requestedAt, Date.parse("2026-08-30T08:00:30.000Z")),
      { retryAfterSeconds: 30 },
    );
    assert.equal(
      assertVerificationResendAllowed(requestedAt, Date.parse("2026-08-30T08:01:00.000Z")),
      null,
    );
    assert.equal(NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS, 60_000);
  });

  it("computes resend countdown from server timestamps", () => {
    assert.equal(
      computeVerificationResendCooldownSeconds(
        "2026-08-30T08:00:00.000Z",
        Date.parse("2026-08-30T08:00:01.000Z"),
      ),
      59,
    );
  });

  it("normalizes user input to uppercase alphanumeric only", () => {
    assert.equal(normalizeVerificationCodeInput(" ab-3d 8k9q "), "AB3D8K9Q");
    assert.equal(
      isValidVerificationCodeFormat(normalizeVerificationCodeInput("7kq9m2px")),
      true,
    );
  });

  it("tracks remaining attempts up to three failures", () => {
    assert.equal(NOTIFICATION_VERIFICATION_MAX_ATTEMPTS, 3);
    assert.equal(remainingVerificationAttempts(0), 3);
    assert.equal(remainingVerificationAttempts(1), 2);
    assert.equal(remainingVerificationAttempts(2), 1);
    assert.equal(remainingVerificationAttempts(3), 0);
  });

  it("documents exact code alphabet and length", () => {
    assert.equal(NOTIFICATION_VERIFICATION_CODE_LENGTH, 8);
    assert.match(NOTIFICATION_VERIFICATION_CODE_ALPHABET, /^[A-Z0-9]+$/);
    assert.equal(NOTIFICATION_VERIFICATION_CODE_PATTERN.source, "^[A-Z0-9]{8}$");
  });
});

describe("notification verification generator wiring", () => {
  it("does not use Math.random in the OTP generator", () => {
    const source = readFileSync("src/lib/mail/verification-token.ts", "utf8");
    assert.doesNotMatch(source, /Math\.random/);
    assert.match(source, /randomBytes/);
  });

  it("stores keyed HMAC digests rather than plaintext codes", () => {
    const tokenSource = readFileSync("src/lib/mail/verification-token.ts", "utf8");
    const service = readFileSync(
      "src/lib/mail/notification-identity-service.ts",
      "utf8",
    );
    assert.match(tokenSource, /createHmac\("sha256"/);
    assert.match(service, /verificationTokenHash/);
    assert.doesNotMatch(service, /verificationTokenPlain/);
  });
});
