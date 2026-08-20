import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateVerificationChallenge,
  hashVerificationToken,
  isVerificationExpired,
  VERIFICATION_TOKEN_ENTROPY_BITS,
} from "@/lib/mail/verification-token";

describe("verification token helpers", () => {
  it("uses 256-bit cryptographic entropy", () => {
    assert.equal(VERIFICATION_TOKEN_ENTROPY_BITS, 256);
    const { token } = generateVerificationChallenge();
    assert.equal(token.length, 64);
  });

  it("hashes tokens consistently", () => {
    const { token, tokenHash } = generateVerificationChallenge();
    assert.equal(hashVerificationToken(token), tokenHash);
    assert.notEqual(token, tokenHash);
  });

  it("detects expired verification windows", () => {
    assert.equal(isVerificationExpired("2000-01-01T00:00:00.000Z"), true);
    assert.equal(
      isVerificationExpired(new Date(Date.now() + 60_000).toISOString()),
      false,
    );
  });
});
