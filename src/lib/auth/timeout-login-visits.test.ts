import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTimeoutLoginReason } from "@/lib/auth/timeout-login-visits";

describe("timeout login visits", () => {
  it("detects timeout login reasons", () => {
    assert.equal(isTimeoutLoginReason("timeout", null), true);
    assert.equal(isTimeoutLoginReason(null, "idle"), true);
    assert.equal(isTimeoutLoginReason("timeout", "idle"), true);
    assert.equal(isTimeoutLoginReason(null, "revoked"), false);
    assert.equal(isTimeoutLoginReason(null, null), false);
  });
});
