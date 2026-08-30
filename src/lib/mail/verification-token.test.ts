import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  NOTIFICATION_VERIFICATION_CODE_PATTERN,
  isValidVerificationCodeFormat,
} from "@/lib/mail/notification-verification-challenge-policy";
import {
  MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR,
} from "@/lib/mail/notification-verification-secret";
import {
  generateVerificationChallenge,
  hashVerificationToken,
} from "@/lib/mail/verification-token";

const TEST_IDENTITY_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TEST_SECRET = "verification-token-unit-test-secret";

describe("verification token helpers", () => {
  before(() => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] = TEST_SECRET;
  });

  after(() => {
    delete process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];
  });

  it("generates exactly 8-character A-Z0-9 codes", () => {
    for (let index = 0; index < 100; index += 1) {
      const { token } = generateVerificationChallenge(TEST_IDENTITY_ID);
      assert.equal(token.length, 8);
      assert.match(token, NOTIFICATION_VERIFICATION_CODE_PATTERN);
      assert.match(token, /[A-Z]/);
      assert.match(token, /[0-9]/);
      assert.doesNotMatch(token, /[a-z]/);
    }
  });

  it("hashes tokens with identity-bound HMAC without storing plaintext semantics in hash", () => {
    const { token, tokenHash } = generateVerificationChallenge(TEST_IDENTITY_ID);
    assert.equal(
      hashVerificationToken(token, TEST_IDENTITY_ID, TEST_SECRET),
      tokenHash,
    );
    assert.notEqual(token, tokenHash);
    assert.equal(tokenHash.length, 64);
  });

  it("rejects invalid example shapes", () => {
    assert.equal(isValidVerificationCodeFormat("ABCDEFGH"), false);
    assert.equal(isValidVerificationCodeFormat("12345678"), false);
    assert.equal(isValidVerificationCodeFormat("ab3D8K9Q"), false);
    assert.equal(isValidVerificationCodeFormat("ABC-1234"), false);
    assert.equal(isValidVerificationCodeFormat("7KQ9M2PX"), true);
  });
});
