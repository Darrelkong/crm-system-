import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ipRestrictedUntilFromPageLoadStatus,
  type IpEmailRestrictionStatusResponse,
} from "@/lib/auth/login-ip-restriction-client";
import { getRemainingRestrictionSeconds } from "@/lib/auth/ip-email-restriction";

describe("login ip restriction client", () => {
  it("returns null when the status endpoint reports no restriction", () => {
    const status: IpEmailRestrictionStatusResponse = { restricted: false };
    assert.equal(ipRestrictedUntilFromPageLoadStatus(status), null);
  });

  it("returns null when the status payload is missing", () => {
    assert.equal(ipRestrictedUntilFromPageLoadStatus(null), null);
    assert.equal(ipRestrictedUntilFromPageLoadStatus(undefined), null);
  });

  it("returns restrictedUntil when the IP is restricted on page load", () => {
    const status: IpEmailRestrictionStatusResponse = {
      restricted: true,
      errorCode: "IP_EMAIL_RESTRICTED",
      remainingSeconds: 57,
      restrictedUntil: "2026-06-27T08:01:00.000Z",
    };

    assert.equal(
      ipRestrictedUntilFromPageLoadStatus(status),
      "2026-06-27T08:01:00.000Z",
    );
  });

  it("keeps countdown based on restrictedUntil instead of resetting penalty duration", () => {
    const restrictedUntil = "2026-06-27T08:01:00.000Z";
    const remainingSeconds = getRemainingRestrictionSeconds(
      restrictedUntil,
      Date.parse("2026-06-27T08:00:03.000Z"),
    );

    assert.equal(remainingSeconds, 57);
    assert.notEqual(remainingSeconds, 60);
  });

  it("allows the login form to become usable after the countdown expires", () => {
    const restrictedUntil = "2026-06-27T08:01:00.000Z";
    const remainingSeconds = getRemainingRestrictionSeconds(
      restrictedUntil,
      Date.parse("2026-06-27T08:01:00.000Z"),
    );

    assert.equal(remainingSeconds, 0);
    assert.equal(ipRestrictedUntilFromPageLoadStatus(null), null);
  });
});
