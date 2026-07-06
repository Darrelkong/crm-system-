import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateSecondaryIdleCode,
  hashSecondaryIdleCode,
  verifySecondaryIdleCode,
} from "@/lib/auth/secondary-idle-code";

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

describe("generateSecondaryIdleCode — format", () => {
  it("generates a code of exactly 8 characters", () => {
    const code = generateSecondaryIdleCode();
    assert.equal(code.length, 8);
  });

  it("contains at least one digit", () => {
    // Run several times to reduce probability of false pass
    for (let i = 0; i < 20; i++) {
      const code = generateSecondaryIdleCode();
      assert.match(code, /[0-9]/, `code "${code}" has no digit`);
    }
  });

  it("contains at least one uppercase letter", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateSecondaryIdleCode();
      assert.match(code, /[A-Z]/, `code "${code}" has no uppercase letter`);
    }
  });

  it("contains at least one lowercase letter", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateSecondaryIdleCode();
      assert.match(code, /[a-z]/, `code "${code}" has no lowercase letter`);
    }
  });

  it("contains only alphanumeric characters", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateSecondaryIdleCode();
      assert.match(code, /^[A-Za-z0-9]{8}$/, `code "${code}" has unexpected chars`);
    }
  });

  it("generates different codes on successive calls", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateSecondaryIdleCode()));
    // With 62^8 ≈ 218 trillion possibilities, any collision would be astronomically unlikely
    assert.ok(codes.size > 45, "expected at least 45 unique codes out of 50 attempts");
  });
});

// ---------------------------------------------------------------------------
// Hash / verify (async — uses Web Crypto PBKDF2)
// ---------------------------------------------------------------------------

describe("hashSecondaryIdleCode — stored format", () => {
  it("returns a non-empty string", async () => {
    const hash = await hashSecondaryIdleCode("Test1234");
    assert.ok(hash.length > 0);
  });

  it("stored value contains a colon separator", async () => {
    const hash = await hashSecondaryIdleCode("Test1234");
    assert.ok(hash.includes(":"), `expected colon in "${hash}"`);
  });

  it("stored value does not contain the plaintext", async () => {
    const code = "AbcD1234";
    const hash = await hashSecondaryIdleCode(code);
    assert.ok(!hash.includes(code), "hash must not contain plaintext");
  });

  it("two hashes of the same code differ (random salt)", async () => {
    const code = "SameCode1";
    const hash1 = await hashSecondaryIdleCode(code);
    const hash2 = await hashSecondaryIdleCode(code);
    assert.notEqual(hash1, hash2, "two hashes of the same code should differ due to random salt");
  });
});

describe("verifySecondaryIdleCode — correct code", () => {
  it("returns true for the correct code", async () => {
    const code = "Correct9";
    const hash = await hashSecondaryIdleCode(code);
    const result = await verifySecondaryIdleCode(code, hash);
    assert.equal(result, true);
  });

  it("returns true regardless of which hash was generated", async () => {
    const code = generateSecondaryIdleCode();
    const hash = await hashSecondaryIdleCode(code);
    assert.equal(await verifySecondaryIdleCode(code, hash), true);
  });
});

describe("verifySecondaryIdleCode — wrong code", () => {
  it("returns false for an incorrect code", async () => {
    const hash = await hashSecondaryIdleCode("GoodCode1");
    const result = await verifySecondaryIdleCode("WrongCod2", hash);
    assert.equal(result, false);
  });

  it("returns false when the code differs by one character", async () => {
    const hash = await hashSecondaryIdleCode("AbcDef12");
    assert.equal(await verifySecondaryIdleCode("AbcDef13", hash), false);
  });

  it("is case-sensitive", async () => {
    const hash = await hashSecondaryIdleCode("AbcD1234");
    assert.equal(await verifySecondaryIdleCode("abcd1234", hash), false);
  });
});

describe("verifySecondaryIdleCode — malformed stored hash", () => {
  it("returns false for an empty stored hash", async () => {
    assert.equal(await verifySecondaryIdleCode("Test1234", ""), false);
  });

  it("returns false for a stored hash without colon", async () => {
    assert.equal(await verifySecondaryIdleCode("Test1234", "notavalidhash"), false);
  });

  it("returns false for a stored hash with only a colon", async () => {
    assert.equal(await verifySecondaryIdleCode("Test1234", ":"), false);
  });

  it("returns false for a completely garbage stored hash", async () => {
    assert.equal(await verifySecondaryIdleCode("Test1234", "garbage:moregarbag"), false);
  });
});

describe("verifySecondaryIdleCode — one-time-use simulation", () => {
  it("old hash does not verify against new hash after rotation simulation", async () => {
    const code = "RotateMe1";
    const oldHash = await hashSecondaryIdleCode(code);
    // Simulate rotation: a new code is generated and hashed
    const newCode = generateSecondaryIdleCode();
    const newHash = await hashSecondaryIdleCode(newCode);

    // Old code no longer matches new hash
    assert.equal(await verifySecondaryIdleCode(code, newHash), false);
    // Only the new code matches the new hash
    assert.equal(await verifySecondaryIdleCode(newCode, newHash), true);
    // Old hash still matches old code (just for completeness)
    assert.equal(await verifySecondaryIdleCode(code, oldHash), true);
  });
});
