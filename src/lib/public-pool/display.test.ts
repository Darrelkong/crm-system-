import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  maskPublicPoolCustomerName,
  truncatePoolReason,
} from "./display";

describe("maskPublicPoolCustomerName", () => {
  it("masks Chinese names to first character + **", () => {
    assert.equal(maskPublicPoolCustomerName("張三三"), "張**");
  });

  it("masks short Chinese names to first character + **", () => {
    assert.equal(maskPublicPoolCustomerName("李"), "李**");
  });

  it("masks English names to first letter + **", () => {
    assert.equal(maskPublicPoolCustomerName("Daniel Smith"), "D**");
  });

  it("masks English single names to first letter + **", () => {
    assert.equal(maskPublicPoolCustomerName("Michael"), "M**");
  });

  it("returns empty string for empty input", () => {
    assert.equal(maskPublicPoolCustomerName(""), "");
  });

  it("returns empty string for whitespace-only input", () => {
    assert.equal(maskPublicPoolCustomerName("   "), "");
  });

  it("trims leading and trailing whitespace before masking", () => {
    assert.equal(maskPublicPoolCustomerName("  張三三  "), "張**");
    assert.equal(maskPublicPoolCustomerName("  Daniel  "), "D**");
  });

  it("returns empty string for null and undefined", () => {
    assert.equal(maskPublicPoolCustomerName(null), "");
    assert.equal(maskPublicPoolCustomerName(undefined), "");
  });
});

describe("truncatePoolReason", () => {
  it("truncates reasons longer than 3 characters", () => {
    assert.equal(truncatePoolReason("自動回收到公共池"), "自動回⋯");
  });

  it("returns exactly 3 characters unchanged", () => {
    assert.equal(truncatePoolReason("客戶是"), "客戶是");
  });

  it("returns fewer than 3 characters unchanged", () => {
    assert.equal(truncatePoolReason("無"), "無");
  });

  it("returns null for null, undefined, and empty values", () => {
    assert.equal(truncatePoolReason(null), null);
    assert.equal(truncatePoolReason(undefined), null);
    assert.equal(truncatePoolReason(""), null);
    assert.equal(truncatePoolReason("   "), null);
  });
});
