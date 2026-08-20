import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeEmailAddress as hashV1NormalizeEmailAddress } from "@/lib/mail/canonical-content-hash-v1-contract";
import {
  MailEmailNormalizationError,
  normalizeMailEmailAddress,
  tryNormalizeMailEmailAddress,
} from "@/lib/mail/normalize-email-address";

describe("normalizeMailEmailAddress", () => {
  it("lowercases the full address", () => {
    assert.equal(
      normalizeMailEmailAddress("Admin@ECHFRONTHK.TEST"),
      "admin@echfronthk.test",
    );
  });

  it("trims surrounding whitespace", () => {
    assert.equal(
      normalizeMailEmailAddress("  user@example.com  "),
      "user@example.com",
    );
  });

  it("applies Unicode NFC normalization", () => {
    const composed = "café@example.com";
    const decomposed = "caf\u0065\u0301@example.com";
    assert.equal(normalizeMailEmailAddress(decomposed), composed);
  });

  it("rejects blank input", () => {
    assert.throws(
      () => normalizeMailEmailAddress("   "),
      MailEmailNormalizationError,
    );
    const result = tryNormalizeMailEmailAddress("   ");
    assert.equal(result.ok, false);
  });

  it("does not strip Gmail dots", () => {
    assert.equal(
      normalizeMailEmailAddress("first.last@gmail.com"),
      "first.last@gmail.com",
    );
  });

  it("does not strip plus tags", () => {
    assert.equal(
      normalizeMailEmailAddress("user+tag@example.com"),
      "user+tag@example.com",
    );
  });

  it("matches frozen Hash v1 address normalization for representative inputs", () => {
    const samples = [
      "Admin@ECHFRONTHK.TEST",
      "  user@example.com  ",
      "caf\u0065\u0301@example.com",
      "first.last@gmail.com",
      "user+tag@example.com",
      "Mixed.Case@Domain.COM",
    ];
    for (const sample of samples) {
      assert.equal(
        normalizeMailEmailAddress(sample),
        hashV1NormalizeEmailAddress(sample),
        `parity failed for ${JSON.stringify(sample)}`,
      );
    }
  });
});
