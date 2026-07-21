import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  idClaimStaffMethodGate,
  randomClaimRoleGate,
  validateRandomClaimRequestBody,
} from "@/lib/public-pool/random-claim-request";

describe("validateRandomClaimRequestBody", () => {
  it("allows empty body and empty JSON object", () => {
    assert.equal(validateRandomClaimRequestBody("").ok, true);
    assert.equal(validateRandomClaimRequestBody("   ").ok, true);
    assert.equal(validateRandomClaimRequestBody("{}").ok, true);
  });

  it("rejects customerId and any non-empty object", () => {
    const withId = validateRandomClaimRequestBody(
      JSON.stringify({ customerId: "x" }),
    );
    assert.equal(withId.ok, false);
    if (!withId.ok) {
      assert.equal(withId.errorCode, "RANDOM_CLAIM_BODY_NOT_ALLOWED");
      assert.equal(withId.httpStatus, 400);
    }

    const withLimit = validateRandomClaimRequestBody(
      JSON.stringify({ limit: 10 }),
    );
    assert.equal(withLimit.ok, false);
  });

  it("rejects invalid JSON and non-objects", () => {
    const invalid = validateRandomClaimRequestBody("{");
    assert.equal(invalid.ok, false);
    if (!invalid.ok) {
      assert.equal(invalid.errorCode, "INVALID_REQUEST_BODY");
    }
    assert.equal(validateRandomClaimRequestBody("[]").ok, false);
    assert.equal(validateRandomClaimRequestBody("null").ok, false);
  });
});

describe("role gates", () => {
  it("random claim is staff-only", () => {
    assert.equal(randomClaimRoleGate("staff").ok, true);
    const admin = randomClaimRoleGate("admin");
    assert.equal(admin.ok, false);
    if (!admin.ok) {
      assert.equal(admin.errorCode, "RANDOM_CLAIM_STAFF_ONLY");
    }
  });

  it("id claim blocks staff and allows admin", () => {
    const staff = idClaimStaffMethodGate("staff");
    assert.equal(staff.ok, false);
    if (!staff.ok) {
      assert.equal(staff.errorCode, "CLAIM_METHOD_NOT_ALLOWED");
    }
    assert.equal(idClaimStaffMethodGate("admin").ok, true);
  });
});
