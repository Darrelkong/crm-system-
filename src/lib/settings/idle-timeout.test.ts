import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  MAX_IDLE_TIMEOUT_MINUTES,
  MIN_IDLE_TIMEOUT_MINUTES,
  isValidIdleTimeoutMinutes,
  parseIdleTimeoutMinutes,
} from "@/lib/settings/idle-timeout";

describe("CRM idle timeout setting", () => {
  it("defaults missing values to 30 minutes", () => {
    assert.equal(
      parseIdleTimeoutMinutes(undefined),
      DEFAULT_IDLE_TIMEOUT_MINUTES,
    );
    assert.equal(parseIdleTimeoutMinutes(null), 30);
    assert.equal(parseIdleTimeoutMinutes(""), 30);
  });

  it("accepts configured values from 5 through 1440 minutes", () => {
    assert.equal(parseIdleTimeoutMinutes("15"), 15);
    assert.equal(parseIdleTimeoutMinutes("60"), 60);
    assert.equal(parseIdleTimeoutMinutes(MIN_IDLE_TIMEOUT_MINUTES), 5);
    assert.equal(parseIdleTimeoutMinutes(MAX_IDLE_TIMEOUT_MINUTES), 1440);
  });

  it("falls back for invalid or out-of-range stored values", () => {
    for (const value of ["0", "4", "1441", "30.5", "abc", "1e2"]) {
      assert.equal(parseIdleTimeoutMinutes(value), 30, value);
    }
    assert.equal(isValidIdleTimeoutMinutes(5), true);
    assert.equal(isValidIdleTimeoutMinutes(1440), true);
    assert.equal(isValidIdleTimeoutMinutes(4), false);
    assert.equal(isValidIdleTimeoutMinutes(1441), false);
    assert.equal(isValidIdleTimeoutMinutes(30.5), false);
  });
});
