import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it, before, after } from "node:test";
import {
  NOTIFICATION_VERIFICATION_CODE_PATTERN,
  NOTIFICATION_VERIFICATION_EXPIRY_MS,
  NOTIFICATION_VERIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS,
  isValidVerificationCodeFormat,
  remainingVerificationAttempts,
} from "@/lib/mail/notification-verification-challenge-policy";
import {
  MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR,
} from "@/lib/mail/notification-verification-secret";
import {
  VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_MAX,
  VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_WINDOW_MS,
} from "@/lib/mail/notification-identity-service";
import {
  buildVerificationChallengeContext,
  generateVerificationChallenge,
  hashVerificationToken,
  verifyVerificationTokenHash,
} from "@/lib/mail/verification-token";

const TEST_SECRET = "phase4-notification-verification-test-secret";
const IDENTITY_A = "11111111-1111-4111-8111-111111111111";
const IDENTITY_B = "22222222-2222-4222-8222-222222222222";

describe("notification verification security correction", () => {
  before(() => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] = TEST_SECRET;
  });

  after(() => {
    delete process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];
  });

  it("never persists plaintext OTP in schema or service sources", () => {
    const schemaSource = readFileSync(
      "drizzle/schema/mail-notification-identities.ts",
      "utf8",
    );
    assert.doesNotMatch(
      schemaSource,
      /verification_token(?!_hash)/i,
      "schema must not add plaintext verification_token column",
    );

    const serviceSource = readFileSync(
      "src/lib/mail/notification-identity-service.ts",
      "utf8",
    );
    const insertStart = serviceSource.indexOf(
      "db.insert(schema.mailNotificationIdentities).values({",
    );
    assert.ok(insertStart >= 0);
    const insertEnd = serviceSource.indexOf("}),", insertStart);
    const insertBlock = serviceSource.slice(insertStart, insertEnd);
    assert.match(insertBlock, /verificationTokenHash:/);
    assert.doesNotMatch(insertBlock, /\btoken\s*:/);
    assert.doesNotMatch(
      insertBlock,
      /\bverificationToken(?!Hash)\s*:/,
      "insert must not persist plaintext verificationToken column",
    );
  });

  it("stores keyed HMAC-SHA256 digests bound to notification identity id", () => {
    const { token, tokenHash } = generateVerificationChallenge(IDENTITY_A);
    const context = buildVerificationChallengeContext(IDENTITY_A);
    const expected = createHmac("sha256", TEST_SECRET)
      .update(`${context}\0${token}`, "utf8")
      .digest("hex");
    assert.equal(tokenHash, expected);
    assert.notEqual(
      tokenHash,
      createHash("sha256").update(token, "utf8").digest("hex"),
    );
  });

  it("does not produce interchangeable verifiers across identity contexts", () => {
    const token = "A1B2C3D4";
    const hashA = hashVerificationToken(token, IDENTITY_A, TEST_SECRET);
    const hashB = hashVerificationToken(token, IDENTITY_B, TEST_SECRET);
    assert.notEqual(hashA, hashB);
    assert.equal(
      verifyVerificationTokenHash(hashA, token, IDENTITY_A, TEST_SECRET),
      true,
    );
    assert.equal(
      verifyVerificationTokenHash(hashA, token, IDENTITY_B, TEST_SECRET),
      false,
    );
  });

  it("verifies valid OTP and rejects invalid OTP via constant-time helper", () => {
    const { token, tokenHash } = generateVerificationChallenge(IDENTITY_A);
    assert.equal(
      verifyVerificationTokenHash(tokenHash, token, IDENTITY_A, TEST_SECRET),
      true,
    );
    assert.equal(
      verifyVerificationTokenHash(tokenHash, "ZZZZ9999", IDENTITY_A, TEST_SECRET),
      false,
    );

    const verifySource = readFileSync(
      "src/lib/mail/verification-token.ts",
      "utf8",
    );
    assert.match(verifySource, /timingSafeEqual/);
  });

  it("preserves 5-minute expiry policy constant", () => {
    assert.equal(NOTIFICATION_VERIFICATION_EXPIRY_MS, 300_000);
    const { expiresAt } = generateVerificationChallenge(
      IDENTITY_A,
      1_700_000_000_000,
    );
    assert.equal(
      expiresAt,
      new Date(1_700_000_300_000).toISOString(),
    );
  });

  it("preserves 3-attempt lockout semantics in policy helpers", () => {
    assert.equal(NOTIFICATION_VERIFICATION_MAX_ATTEMPTS, 3);
    assert.equal(remainingVerificationAttempts(0), 3);
    assert.equal(remainingVerificationAttempts(1), 2);
    assert.equal(remainingVerificationAttempts(2), 1);
    assert.equal(remainingVerificationAttempts(3), 0);
  });

  it("preserves 60-second resend cooldown constant", () => {
    assert.equal(NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS, 60_000);
  });

  it("preserves 24-hour verification issue rate limit constants", () => {
    assert.equal(VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_MAX, 3);
    assert.equal(
      VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_WINDOW_MS,
      24 * 60 * 60 * 1000,
    );
    const serviceSource = readFileSync(
      "src/lib/mail/notification-identity-service.ts",
      "utf8",
    );
    assert.match(serviceSource, /assertVerificationTokenIssueRateLimit/);
    assert.match(serviceSource, /isVerificationTokenIssueRateLimitExempt/);
    assert.match(serviceSource, /isCrmRootAdmin\(actor\)/);
  });

  it("propagates policy errors instead of swallowing them as delivery_failed", () => {
    const serviceSource = readFileSync(
      "src/lib/mail/notification-identity-service.ts",
      "utf8",
    );
    assert.match(
      serviceSource,
      /if \(isVerificationChallengeDeliveryFailure\(error\)\) \{[\s\S]*delivered = false;[\s\S]*\} else \{[\s\S]*throw error;/,
    );
    assert.doesNotMatch(
      serviceSource,
      /catch \{\s*delivered = false;\s*\}/,
    );
  });

  it("commits challenge rotation only after successful delivery in send path", () => {
    const serviceSource = readFileSync(
      "src/lib/mail/notification-identity-service.ts",
      "utf8",
    );
    const deliverIndex = serviceSource.indexOf(
      "async function deliverAndCommitVerificationChallenge",
    );
    const commitIndex = serviceSource.indexOf(
      "async function commitVerificationChallengeRotation",
    );
    const deliverBody = serviceSource.slice(deliverIndex, deliverIndex + 1200);
    assert.match(
      deliverBody,
      /await input\.deliver\([\s\S]*await commitVerificationChallengeRotation/,
    );
    assert.ok(commitIndex < deliverIndex);
  });

  it("delivers before persisting hash in outbox processor", () => {
    const outboxSource = readFileSync(
      "src/lib/mail/notification-verification-outbox-processing-service.ts",
      "utf8",
    );
    const deliverIndex = outboxSource.indexOf("await input.sink.deliverChallenge");
    const hashPersistIndex = outboxSource.indexOf(
      "verificationTokenHash: challenge.tokenHash",
    );
    assert.ok(
      deliverIndex > 0 && hashPersistIndex > deliverIndex,
      "outbox must deliver before persisting canonical hash",
    );
  });

  it("does not include OTP tokens in audit metadata builders", () => {
    const serviceSource = readFileSync(
      "src/lib/mail/notification-identity-service.ts",
      "utf8",
    );
    const metadataBlocks =
      serviceSource.match(/metadata:\s*\{[^{}]+\}/g) ?? [];
    assert.ok(metadataBlocks.length > 0);
    for (const block of metadataBlocks) {
      assert.doesNotMatch(block, /\btoken\b/);
      assert.doesNotMatch(block, /verificationToken/);
    }
  });

  it("generates 8-character A-Z0-9 codes with letter and digit", () => {
    for (let index = 0; index < 50; index += 1) {
      const { token } = generateVerificationChallenge(IDENTITY_A);
      assert.equal(token.length, 8);
      assert.match(token, NOTIFICATION_VERIFICATION_CODE_PATTERN);
      assert.equal(isValidVerificationCodeFormat(token), true);
    }
  });
});
