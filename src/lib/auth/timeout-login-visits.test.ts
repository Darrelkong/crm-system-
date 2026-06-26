import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TIMEOUT_ACCESS_LOGOUT_VISIT_THRESHOLD,
  isTimeoutLoginReason,
  shouldForceAccessLogoutAfterTimeoutVisit,
} from "@/lib/auth/timeout-login-visits";

describe("timeout login visits", () => {
  it("uses a threshold of 3 timeout visits before Access logout", () => {
    assert.equal(TIMEOUT_ACCESS_LOGOUT_VISIT_THRESHOLD, 3);
  });

  it("detects timeout login reasons", () => {
    assert.equal(isTimeoutLoginReason("timeout", null), true);
    assert.equal(isTimeoutLoginReason(null, "idle"), true);
    assert.equal(isTimeoutLoginReason("timeout", "idle"), true);
    assert.equal(isTimeoutLoginReason(null, "revoked"), false);
    assert.equal(isTimeoutLoginReason(null, null), false);
  });

  it("does not force Access logout before the third timeout visit", () => {
    assert.equal(shouldForceAccessLogoutAfterTimeoutVisit(1, false), false);
    assert.equal(shouldForceAccessLogoutAfterTimeoutVisit(2, false), false);
  });

  it("forces Access logout on the third timeout visit in production", () => {
    assert.equal(shouldForceAccessLogoutAfterTimeoutVisit(3, false), true);
    assert.equal(shouldForceAccessLogoutAfterTimeoutVisit(4, false), true);
  });

  it("never forces Access logout on localhost", () => {
    assert.equal(shouldForceAccessLogoutAfterTimeoutVisit(3, true), false);
    assert.equal(shouldForceAccessLogoutAfterTimeoutVisit(10, true), false);
  });
});
