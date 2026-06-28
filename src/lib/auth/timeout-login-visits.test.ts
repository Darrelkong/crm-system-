import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTimeoutLoginReason } from "@/lib/auth/timeout-login-visits";
import { IDLE_RELOGIN_THRESHOLD } from "@/lib/auth/idle-relogin-cookie";

describe("timeout login visits", () => {
  it("shares the idle reverify threshold with server idle relogin cookies", () => {
    assert.equal(IDLE_RELOGIN_THRESHOLD, 3);
  });

  it("detects timeout login reasons", () => {
    assert.equal(isTimeoutLoginReason("timeout", null), true);
    assert.equal(isTimeoutLoginReason(null, "idle"), true);
    assert.equal(isTimeoutLoginReason("timeout", "idle"), true);
    assert.equal(isTimeoutLoginReason(null, "revoked"), false);
    assert.equal(isTimeoutLoginReason(null, null), false);
  });
});
