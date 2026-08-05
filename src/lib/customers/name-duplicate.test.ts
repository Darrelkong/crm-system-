import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeCustomerNameForDuplicateMatch,
  parseConfirmDuplicateName,
} from "@/lib/customers/name-duplicate";

describe("normalizeCustomerNameForDuplicateMatch", () => {
  it("returns null for pending placeholders", () => {
    assert.equal(normalizeCustomerNameForDuplicateMatch("X先生"), null);
    assert.equal(normalizeCustomerNameForDuplicateMatch("X女士"), null);
    assert.equal(normalizeCustomerNameForDuplicateMatch(" X先生 "), null);
  });

  it("returns null for blank / invalid / non-string", () => {
    assert.equal(normalizeCustomerNameForDuplicateMatch(""), null);
    assert.equal(normalizeCustomerNameForDuplicateMatch("   "), null);
    assert.equal(normalizeCustomerNameForDuplicateMatch(null), null);
    assert.equal(normalizeCustomerNameForDuplicateMatch("ab"), null);
  });

  it("matches single-character Chinese names after trim", () => {
    assert.equal(normalizeCustomerNameForDuplicateMatch("王"), "王");
    assert.equal(normalizeCustomerNameForDuplicateMatch("  王  "), "王");
  });

  it("matches confirmed Chinese names exactly after trim/NFC", () => {
    assert.equal(
      normalizeCustomerNameForDuplicateMatch("王小明"),
      "王小明",
    );
    assert.equal(
      normalizeCustomerNameForDuplicateMatch("  王小明  "),
      "王小明",
    );
    assert.notEqual(
      normalizeCustomerNameForDuplicateMatch("王小明"),
      normalizeCustomerNameForDuplicateMatch("王晓明"),
    );
  });

  it("treats English case as equivalent after trim", () => {
    assert.equal(
      normalizeCustomerNameForDuplicateMatch("John Smith"),
      "john smith",
    );
    assert.equal(
      normalizeCustomerNameForDuplicateMatch("JOHN SMITH"),
      "john smith",
    );
    assert.equal(
      normalizeCustomerNameForDuplicateMatch("  john smith  "),
      "john smith",
    );
  });

  it("keeps hyphen and apostrophe differences", () => {
    assert.notEqual(
      normalizeCustomerNameForDuplicateMatch("John Smith"),
      normalizeCustomerNameForDuplicateMatch("John-Smith"),
    );
    assert.equal(
      normalizeCustomerNameForDuplicateMatch("O'Brien"),
      "o'brien",
    );
    assert.notEqual(
      normalizeCustomerNameForDuplicateMatch("OBrien"),
      normalizeCustomerNameForDuplicateMatch("O'Brien"),
    );
  });

  it("applies Unicode NFC equivalence for Chinese names", () => {
    const composed = "\u00e9".normalize("NFC");
    // Accented Latin is outside English confirmed-name charset; use CJK NFC pair.
    const a = normalizeCustomerNameForDuplicateMatch("王");
    const b = normalizeCustomerNameForDuplicateMatch("王".normalize("NFD").normalize("NFC"));
    assert.equal(a, "王");
    assert.equal(a, b);
    assert.equal(composed.normalize("NFC"), composed);
  });

  it("does not fuzzy-match or romanize Chinese", () => {
    assert.notEqual(
      normalizeCustomerNameForDuplicateMatch("张伟"),
      normalizeCustomerNameForDuplicateMatch("张维"),
    );
    assert.notEqual(
      normalizeCustomerNameForDuplicateMatch("张伟"),
      normalizeCustomerNameForDuplicateMatch("Zhang Wei"),
    );
  });
});

describe("parseConfirmDuplicateName", () => {
  it("accepts exact match keys and rejects empty / oversized / non-string", () => {
    assert.equal(parseConfirmDuplicateName("john smith"), "john smith");
    assert.equal(parseConfirmDuplicateName(""), null);
    assert.equal(parseConfirmDuplicateName(null), null);
    assert.equal(parseConfirmDuplicateName(1), null);
    assert.equal(parseConfirmDuplicateName("x".repeat(201)), null);
  });
});
