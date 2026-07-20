import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  interpretAuthMeResponse,
  planIdleCheckAfterMe,
  planLoginAccessReverifyResponse,
  shouldSkipLocalIdleTimeout,
} from "@/lib/auth/idle-timeout-check";

const IDLE_MS = 30 * 60 * 1000;
const NOW = 1_000_000;

describe("shouldSkipLocalIdleTimeout", () => {
  it("skips when globalIdleTimeoutExempt is true", () => {
    assert.equal(
      shouldSkipLocalIdleTimeout({
        globalIdleTimeoutExempt: true,
        idleExemptUntilMs: null,
        nowMs: NOW,
      }),
      true,
    );
  });

  it("skips when single-session idleExemptUntil is still valid", () => {
    assert.equal(
      shouldSkipLocalIdleTimeout({
        globalIdleTimeoutExempt: false,
        idleExemptUntilMs: NOW + 60_000,
        nowMs: NOW,
      }),
      true,
    );
  });

  it("runs local idle when both are inactive", () => {
    assert.equal(
      shouldSkipLocalIdleTimeout({
        globalIdleTimeoutExempt: false,
        idleExemptUntilMs: null,
        nowMs: NOW,
      }),
      false,
    );
    assert.equal(
      shouldSkipLocalIdleTimeout({
        globalIdleTimeoutExempt: false,
        idleExemptUntilMs: NOW - 1,
        nowMs: NOW,
      }),
      false,
    );
  });
});

describe("interpretAuthMeResponse", () => {
  it("maps access_reverify 401 to session_end", () => {
    assert.deepEqual(
      interpretAuthMeResponse({
        status: 401,
        errorCode: "SESSION_ACCESS_REVERIFY_REQUIRED",
      }),
      { kind: "session_end", reason: "access_reverify" },
    );
  });

  it("maps other session 401 codes", () => {
    assert.deepEqual(
      interpretAuthMeResponse({
        status: 401,
        errorCode: "SESSION_IDLE_EXPIRED",
      }),
      { kind: "session_end", reason: "idle" },
    );
    assert.deepEqual(
      interpretAuthMeResponse({
        status: 401,
        errorCode: "SESSION_REVOKED",
      }),
      { kind: "session_end", reason: "revoked" },
    );
    assert.deepEqual(
      interpretAuthMeResponse({
        status: 401,
        errorCode: "SESSION_DEVICE_REVOKED",
      }),
      { kind: "session_end", reason: "device_revoked" },
    );
  });

  it("reads globalIdleTimeoutExempt on success", () => {
    assert.deepEqual(
      interpretAuthMeResponse({
        status: 200,
        globalIdleTimeoutExempt: true,
      }),
      { kind: "ok", globalIdleTimeoutExempt: true },
    );
    assert.deepEqual(
      interpretAuthMeResponse({
        status: 200,
        globalIdleTimeoutExempt: false,
      }),
      { kind: "ok", globalIdleTimeoutExempt: false },
    );
  });

  it("ignores 403 and unknown 401", () => {
    assert.equal(interpretAuthMeResponse({ status: 403 }).kind, "ignore");
    assert.equal(
      interpretAuthMeResponse({ status: 401, errorCode: "UNAUTHENTICATED" })
        .kind,
      "ignore",
    );
  });
});

describe("planIdleCheckAfterMe", () => {
  it("access_reverify ends session immediately without modal", () => {
    const plan = planIdleCheckAfterMe({
      me: { kind: "session_end", reason: "access_reverify" },
      idleExemptUntilMs: NOW + 999_999,
      nowMs: NOW,
      lastActivityMs: NOW,
      idleMs: IDLE_MS,
    });
    assert.deepEqual(plan, {
      type: "end_session",
      reason: "access_reverify",
      showModal: false,
      immediateRedirect: true,
    });
  });

  it("ordinary idle/revoked/device_revoked keep modal + delayed redirect plan", () => {
    for (const reason of ["idle", "revoked", "invalid", "device_revoked"] as const) {
      const plan = planIdleCheckAfterMe({
        me: { kind: "session_end", reason },
        idleExemptUntilMs: null,
        nowMs: NOW,
        lastActivityMs: NOW,
        idleMs: IDLE_MS,
      });
      assert.deepEqual(plan, {
        type: "end_session",
        reason,
        showModal: true,
        immediateRedirect: false,
      });
    }
  });

  it("global true from me skips local idle on this check", () => {
    const plan = planIdleCheckAfterMe({
      me: { kind: "ok", globalIdleTimeoutExempt: true },
      idleExemptUntilMs: null,
      nowMs: NOW,
      lastActivityMs: NOW - IDLE_MS - 1,
      idleMs: IDLE_MS,
    });
    assert.deepEqual(plan, {
      type: "skip_local_idle",
      globalIdleTimeoutExempt: true,
    });
  });

  it("global false restores local idle evaluation", () => {
    const plan = planIdleCheckAfterMe({
      me: { kind: "ok", globalIdleTimeoutExempt: false },
      idleExemptUntilMs: null,
      nowMs: NOW,
      lastActivityMs: NOW - IDLE_MS - 1,
      idleMs: IDLE_MS,
    });
    assert.equal(plan.type, "local_idle_expired");
  });

  it("single-session exempt skips local idle after successful me", () => {
    const plan = planIdleCheckAfterMe({
      me: { kind: "ok", globalIdleTimeoutExempt: false },
      idleExemptUntilMs: NOW + 60_000,
      nowMs: NOW,
      lastActivityMs: NOW - IDLE_MS - 1,
      idleMs: IDLE_MS,
    });
    assert.equal(plan.type, "skip_local_idle");
  });

  it("me session_end wins over active local exempt", () => {
    const plan = planIdleCheckAfterMe({
      me: { kind: "session_end", reason: "access_reverify" },
      idleExemptUntilMs: NOW + 60_000,
      nowMs: NOW,
      lastActivityMs: NOW,
      idleMs: IDLE_MS,
    });
    assert.equal(plan.type, "end_session");
    if (plan.type === "end_session") {
      assert.equal(plan.reason, "access_reverify");
    }
  });

  it("continue when activity is fresh and not exempt", () => {
    const plan = planIdleCheckAfterMe({
      me: { kind: "ok", globalIdleTimeoutExempt: false },
      idleExemptUntilMs: null,
      nowMs: NOW,
      lastActivityMs: NOW - 1000,
      idleMs: IDLE_MS,
    });
    assert.equal(plan.type, "continue");
  });
});

describe("planLoginAccessReverifyResponse", () => {
  it("production redirects to Access logout", () => {
    assert.deepEqual(
      planLoginAccessReverifyResponse({ isLocalDevelopment: false }),
      { action: "redirect_access_logout" },
    );
  });

  it("local development shows dedicated notice", () => {
    assert.deepEqual(
      planLoginAccessReverifyResponse({ isLocalDevelopment: true }),
      { action: "show_local_notice" },
    );
  });
});
