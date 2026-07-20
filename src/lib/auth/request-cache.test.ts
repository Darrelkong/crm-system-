import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAuthFromValidation } from "@/lib/auth/request-cache";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { AuthError } from "@/lib/permissions/auth";
import type { SessionValidationResult } from "@/lib/auth/session";
import type { User } from "../../../drizzle/schema/users";

/**
 * Tests for resolveAuthFromValidation() — the pure, synchronous function that
 * maps a SessionValidationResult to a User or throws an AuthError.
 *
 * The react.cache() memoization layer (getRequestValidation) is a React
 * framework feature that is request-scoped by the React render tree. Its
 * behaviour is not unit-tested here; the correctness of the memoisation is
 * guaranteed by React and validated during integration / e2e testing.
 */

const NOW = new Date().toISOString();

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "user@example.com",
    displayName: "Test User",
    passwordHash: "hash",
    role: "admin",
    isActive: 1,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: 0,
    passwordChangedAt: null,
    passwordResetAt: null,
    initialDeviceAutoApprovalEligible: 0,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function okResult(user: User): SessionValidationResult {
  return {
    ok: true,
    session: { sessionId: "sess-1", user, deviceIdHash: null },
    globalIdleTimeoutExempt: false,
  };
}

function failResult(
  reason: Extract<SessionValidationResult, { ok: false }>["reason"],
  errorCode?: string,
): SessionValidationResult {
  return { ok: false, reason, ...(errorCode ? { errorCode } : {}) };
}

// ---------------------------------------------------------------------------
// Happy-path: valid sessions
// ---------------------------------------------------------------------------

describe("resolveAuthFromValidation — valid session", () => {
  it("returns admin user when session is valid", () => {
    const user = makeUser({ role: "admin" });
    const result = resolveAuthFromValidation(okResult(user));
    assert.equal(result.id, "user-1");
    assert.equal(result.role, "admin");
  });

  it("returns staff user when session is valid", () => {
    const user = makeUser({ role: "staff", id: "user-staff" });
    const result = resolveAuthFromValidation(okResult(user));
    assert.equal(result.role, "staff");
  });

  it("throws 403 when user.isActive is 0", () => {
    const user = makeUser({ isActive: 0 });
    assert.throws(
      () => resolveAuthFromValidation(okResult(user)),
      (err: unknown) => err instanceof AuthError && err.status === 403,
    );
  });

  it("throws MUST_CHANGE_PASSWORD when mustChangePassword=1", () => {
    const user = makeUser({ mustChangePassword: 1 });
    assert.throws(
      () => resolveAuthFromValidation(okResult(user)),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.MUST_CHANGE_PASSWORD,
    );
  });

  it("passes through when allowMustChangePassword=true", () => {
    const user = makeUser({ mustChangePassword: 1 });
    const result = resolveAuthFromValidation(okResult(user), {
      allowMustChangePassword: true,
    });
    assert.equal(result.id, "user-1");
  });
});

// ---------------------------------------------------------------------------
// Error cases: each session failure reason maps to the correct AuthError
// ---------------------------------------------------------------------------

describe("resolveAuthFromValidation — session errors", () => {
  it("throws SESSION_IDLE_EXPIRED for idle_expired reason", () => {
    const result = failResult(
      "idle_expired",
      AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED,
    );
    assert.throws(
      () => resolveAuthFromValidation(result),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED &&
        err.status === 401,
    );
  });

  it("throws SESSION_IDLE_EXPIRED by reason alone (no errorCode)", () => {
    assert.throws(
      () => resolveAuthFromValidation(failResult("idle_expired")),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED,
    );
  });

  it("throws SESSION_REVOKED for revoked reason", () => {
    const result = failResult("revoked", AUTH_ERROR_CODES.SESSION_REVOKED);
    assert.throws(
      () => resolveAuthFromValidation(result),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.SESSION_REVOKED,
    );
  });

  it("throws SESSION_DEVICE_REVOKED for device_revoked reason", () => {
    const result = failResult(
      "device_revoked",
      AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED,
    );
    assert.throws(
      () => resolveAuthFromValidation(result),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED &&
        err.status === 401,
    );
  });

  it("throws SESSION_ACCESS_REVERIFY_REQUIRED for access_reverify reason", () => {
    const result = failResult(
      "access_reverify",
      AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED,
    );
    assert.throws(
      () => resolveAuthFromValidation(result),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED &&
        err.status === 401,
    );
  });

  it("throws SESSION_INVALID for invalid reason", () => {
    const result = failResult("invalid", AUTH_ERROR_CODES.SESSION_INVALID);
    assert.throws(
      () => resolveAuthFromValidation(result),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.SESSION_INVALID,
    );
  });

  it("throws UNAUTHENTICATED for missing token", () => {
    assert.throws(
      () => resolveAuthFromValidation(failResult("missing")),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.UNAUTHENTICATED &&
        err.status === 401,
    );
  });

  it("throws UNAUTHENTICATED for inactive_user (mirrors requireAuth fallback)", () => {
    assert.throws(
      () => resolveAuthFromValidation(failResult("inactive_user")),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.UNAUTHENTICATED,
    );
  });
});

// ---------------------------------------------------------------------------
// Role-checking: admin and staff separation
// ---------------------------------------------------------------------------

describe("resolveAuthFromValidation — role metadata is preserved", () => {
  it("admin role is preserved in the returned user", () => {
    const user = makeUser({ role: "admin" });
    assert.equal(resolveAuthFromValidation(okResult(user)).role, "admin");
  });

  it("staff role is preserved in the returned user", () => {
    const user = makeUser({ role: "staff" });
    assert.equal(resolveAuthFromValidation(okResult(user)).role, "staff");
  });
});

// ---------------------------------------------------------------------------
// Device authorization: device_revoked is surfaced correctly
// The actual device DB check happens inside validateSessionToken (session.ts).
// Here we verify that when validateSessionToken returns device_revoked,
// resolveAuthFromValidation throws the correct AuthError so the Server
// Component behaves the same as requireAuth().
// ---------------------------------------------------------------------------

describe("resolveAuthFromValidation — device authorization", () => {
  it("throws SESSION_DEVICE_REVOKED when device is revoked", () => {
    const result: SessionValidationResult = {
      ok: false,
      reason: "device_revoked",
      errorCode: AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED,
    };
    assert.throws(
      () => resolveAuthFromValidation(result),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED,
    );
  });

  it("returns user normally when device is approved (ok:true result)", () => {
    const user = makeUser({ role: "staff" });
    assert.doesNotThrow(() => resolveAuthFromValidation(okResult(user)));
  });
});
