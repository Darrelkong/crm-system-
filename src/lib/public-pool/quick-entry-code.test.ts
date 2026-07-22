import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isQuickEntryCodeBodyRejectable,
  validateQuickEntryCodeFormat,
} from "@/lib/public-pool/quick-entry-code";
import { QUICK_ENTRY_ERROR_CODES } from "@/lib/public-pool/quick-entry-constants";

describe("validateQuickEntryCodeFormat", () => {
  it("accepts 8–64 chars with letter and digit", () => {
    const result = validateQuickEntryCodeFormat("Abcd1234");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.code, "Abcd1234");
  });

  it("accepts symbols when letter+digit present", () => {
    const result = validateQuickEntryCodeFormat("Abcd12!@");
    assert.equal(result.ok, true);
  });

  it("rejects shorter than 8", () => {
    const result = validateQuickEntryCodeFormat("Abc1234");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.errorCode,
        QUICK_ENTRY_ERROR_CODES.CODE_INVALID_FORMAT,
      );
    }
  });

  it("rejects longer than 64", () => {
    const result = validateQuickEntryCodeFormat("A1" + "x".repeat(63));
    assert.equal(result.ok, false);
  });

  it("rejects leading/trailing whitespace", () => {
    assert.equal(validateQuickEntryCodeFormat(" Abcd1234").ok, false);
    assert.equal(validateQuickEntryCodeFormat("Abcd1234 ").ok, false);
  });

  it("rejects letters-only and digits-only", () => {
    assert.equal(validateQuickEntryCodeFormat("Abcdefgh").ok, false);
    assert.equal(validateQuickEntryCodeFormat("12345678").ok, false);
  });

  it("rejects null, array, object, empty", () => {
    assert.equal(validateQuickEntryCodeFormat(null).ok, false);
    assert.equal(validateQuickEntryCodeFormat(["Abcd1234"]).ok, false);
    assert.equal(validateQuickEntryCodeFormat({ code: "Abcd1234" }).ok, false);
    assert.equal(validateQuickEntryCodeFormat("").ok, false);
    assert.equal(validateQuickEntryCodeFormat("        ").ok, false);
  });
});

describe("isQuickEntryCodeBodyRejectable", () => {
  it("rejects non-string and oversized bodies", () => {
    assert.equal(isQuickEntryCodeBodyRejectable(null), true);
    assert.equal(isQuickEntryCodeBodyRejectable(1), true);
    assert.equal(isQuickEntryCodeBodyRejectable({}), true);
    assert.equal(isQuickEntryCodeBodyRejectable("x".repeat(65)), true);
  });

  it("does not reject normal-length wrong-format strings", () => {
    assert.equal(isQuickEntryCodeBodyRejectable("short"), false);
    assert.equal(isQuickEntryCodeBodyRejectable("Abcdefgh"), false);
  });
});
