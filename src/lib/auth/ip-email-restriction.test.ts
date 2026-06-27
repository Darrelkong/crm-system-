import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IP_EMAIL_ATTEMPT_THRESHOLD,
  applyUnauthorizedEmailAttempt,
  buildIpEmailRestrictionStatusPayload,
  getActiveIpEmailRestriction,
  getClientIpFromRequest,
  getPenaltyDurationSeconds,
  getRemainingRestrictionSeconds,
  hasDisallowedIpEmailRestrictionStatusQuery,
} from "@/lib/auth/ip-email-restriction";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";

describe("ip email restriction", () => {
  it("uses a threshold of 3 invalid emails per round", () => {
    assert.equal(IP_EMAIL_ATTEMPT_THRESHOLD, 3);
  });

  it("does not restrict on the first two invalid emails", () => {
    const t0 = Date.parse("2026-06-27T08:00:00.000Z");
    const first = applyUnauthorizedEmailAttempt(null, t0);
    assert.equal(first.result.kind, "unauthorized");
    assert.equal(first.state.failedEmailAttempts, 1);

    const second = applyUnauthorizedEmailAttempt(first.state, t0);
    assert.equal(second.result.kind, "unauthorized");
    assert.equal(second.state.failedEmailAttempts, 2);
  });

  it("restricts for 60 seconds on the third invalid email in the first round", () => {
    const t0 = Date.parse("2026-06-27T08:00:00.000Z");
    const second = applyUnauthorizedEmailAttempt(
      applyUnauthorizedEmailAttempt(null, t0).state,
      t0,
    );
    const third = applyUnauthorizedEmailAttempt(second.state, t0);

    assert.equal(third.result.kind, "restricted");
    if (third.result.kind === "restricted") {
      assert.equal(third.result.remainingSeconds, 60);
      assert.equal(
        third.result.restrictedUntil,
        "2026-06-27T08:01:00.000Z",
      );
    }
    assert.equal(third.state.penaltyLevel, 1);
    assert.equal(third.state.failedEmailAttempts, 0);
  });

  it("restricts for 120 seconds on the third invalid email in the second round", () => {
    const t0 = Date.parse("2026-06-27T08:00:00.000Z");
    const afterFirstPenalty = {
      failedEmailAttempts: 0,
      penaltyLevel: 1,
      restrictedUntil: null,
    };
    const first = applyUnauthorizedEmailAttempt(afterFirstPenalty, t0);
    const second = applyUnauthorizedEmailAttempt(first.state, t0);
    const third = applyUnauthorizedEmailAttempt(second.state, t0);

    assert.equal(third.result.kind, "restricted");
    if (third.result.kind === "restricted") {
      assert.equal(third.result.remainingSeconds, 120);
      assert.equal(
        third.result.restrictedUntil,
        "2026-06-27T08:02:00.000Z",
      );
    }
    assert.equal(third.state.penaltyLevel, 2);
  });

  it("restricts for 300 seconds on the third invalid email in the third round", () => {
    const t0 = Date.parse("2026-06-27T08:00:00.000Z");
    const afterSecondPenalty = {
      failedEmailAttempts: 0,
      penaltyLevel: 2,
      restrictedUntil: null,
    };
    const first = applyUnauthorizedEmailAttempt(afterSecondPenalty, t0);
    const second = applyUnauthorizedEmailAttempt(first.state, t0);
    const third = applyUnauthorizedEmailAttempt(second.state, t0);

    assert.equal(third.result.kind, "restricted");
    if (third.result.kind === "restricted") {
      assert.equal(third.result.remainingSeconds, 300);
    }
    assert.equal(third.state.penaltyLevel, 3);
  });

  it("keeps later rounds at 300 seconds", () => {
    assert.equal(getPenaltyDurationSeconds(4), 300);
    assert.equal(getPenaltyDurationSeconds(10), 300);
  });

  it("reports active restriction while restricted_until is in the future", () => {
    const active = getActiveIpEmailRestriction(
      {
        failedEmailAttempts: 0,
        penaltyLevel: 1,
        restrictedUntil: "2026-06-27T08:01:00.000Z",
      },
      Date.parse("2026-06-27T08:00:30.000Z"),
    );

    assert.equal(active.restricted, true);
    if (active.restricted) {
      assert.equal(active.remainingSeconds, 30);
    }
  });

  it("clears expired restriction windows", () => {
    const active = getActiveIpEmailRestriction(
      {
        failedEmailAttempts: 0,
        penaltyLevel: 1,
        restrictedUntil: "2026-06-27T08:01:00.000Z",
      },
      Date.parse("2026-06-27T08:01:01.000Z"),
    );

    assert.equal(active.restricted, false);
  });

  it("computes remaining seconds from restrictedUntil", () => {
    assert.equal(
      getRemainingRestrictionSeconds(
        "2026-06-27T08:01:00.000Z",
        Date.parse("2026-06-27T08:00:00.000Z"),
      ),
      60,
    );
  });

  it("builds unrestricted status payload", () => {
    assert.deepEqual(buildIpEmailRestrictionStatusPayload({ restricted: false }), {
      restricted: false,
    });
  });

  it("builds restricted status payload with remainingSeconds and restrictedUntil", () => {
    const payload = buildIpEmailRestrictionStatusPayload({
      restricted: true,
      restrictedUntil: "2026-06-27T08:01:00.000Z",
      remainingSeconds: 57,
    });

    assert.equal(payload.restricted, true);
    if (payload.restricted) {
      assert.equal(payload.errorCode, AUTH_ERROR_CODES.IP_EMAIL_RESTRICTED);
      assert.equal(payload.remainingSeconds, 57);
      assert.equal(payload.restrictedUntil, "2026-06-27T08:01:00.000Z");
    }
  });

  it("rejects query parameters on the status endpoint", () => {
    assert.equal(
      hasDisallowedIpEmailRestrictionStatusQuery(
        new URLSearchParams("ip=1.2.3.4"),
      ),
      true,
    );
    assert.equal(
      hasDisallowedIpEmailRestrictionStatusQuery(new URLSearchParams("")),
      false,
    );
  });

  it("derives client IP from cf-connecting-ip first", () => {
    const request = new Request("https://crm.example/login", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.1",
      },
    });

    assert.equal(getClientIpFromRequest(request), "203.0.113.10");
  });

  it("falls back to the first x-forwarded-for IP", () => {
    const request = new Request("https://crm.example/login", {
      headers: {
        "x-forwarded-for": "198.51.100.1, 203.0.113.10",
      },
    });

    assert.equal(getClientIpFromRequest(request), "198.51.100.1");
  });

  it("falls back to unknown when no IP headers are present", () => {
    const request = new Request("https://crm.example/login");
    assert.equal(getClientIpFromRequest(request), "unknown");
  });
});
