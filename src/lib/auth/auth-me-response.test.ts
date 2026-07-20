import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAuthMeSuccessPayload } from "@/lib/auth/auth-me-response";
import { resolveAuthFromValidation } from "@/lib/auth/request-cache";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { AuthError } from "@/lib/permissions/auth";
import type { SessionValidationResult } from "@/lib/auth/session";
import type { User } from "../../../drizzle/schema/users";

const NOW = new Date().toISOString();

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "user@example.com",
    displayName: "Test User",
    passwordHash: "hash",
    role: "staff",
    isActive: 1,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: 0,
    passwordChangedAt: null,
    passwordResetAt: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function okResult(
  user: User,
  globalIdleTimeoutExempt: boolean,
): Extract<SessionValidationResult, { ok: true }> {
  return {
    ok: true,
    session: { sessionId: "sess-1", user },
    globalIdleTimeoutExempt,
  };
}

describe("buildAuthMeSuccessPayload", () => {
  it("returns globalIdleTimeoutExempt: true when policy exempt", () => {
    const payload = buildAuthMeSuccessPayload(okResult(makeUser(), true));
    assert.equal(payload.globalIdleTimeoutExempt, true);
    assert.equal(payload.user.id, "user-1");
    assert.equal(payload.user.email, "user@example.com");
    assert.equal(payload.user.displayName, "Test User");
    assert.equal(payload.user.role, "staff");
    assert.equal(payload.user.mustChangePassword, false);
  });

  it("returns globalIdleTimeoutExempt: false when policy not exempt", () => {
    const payload = buildAuthMeSuccessPayload(okResult(makeUser(), false));
    assert.equal(payload.globalIdleTimeoutExempt, false);
  });

  it("works for admin sessions", () => {
    const payload = buildAuthMeSuccessPayload(
      okResult(makeUser({ role: "admin", id: "admin-1" }), true),
    );
    assert.equal(payload.user.role, "admin");
    assert.equal(payload.globalIdleTimeoutExempt, true);
  });

  it("does not expose epoch, Access iat, or internal security fields", () => {
    const payload = buildAuthMeSuccessPayload(okResult(makeUser(), true));
    const json = JSON.stringify(payload);
    assert.ok(!json.includes("staffAccessReverifyAfter"));
    assert.ok(!json.includes("staff_access_reverify_after"));
    assert.ok(!json.includes("accessJwtIat"));
    assert.ok(!json.includes("idleExemptUntil"));
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, "session"));
    assert.deepEqual(Object.keys(payload).sort(), [
      "globalIdleTimeoutExempt",
      "user",
    ]);
    assert.deepEqual(Object.keys(payload.user).sort(), [
      "displayName",
      "email",
      "id",
      "mustChangePassword",
      "role",
    ]);
  });

  it("preserves mustChangePassword boolean from user flag", () => {
    const payload = buildAuthMeSuccessPayload(
      okResult(makeUser({ mustChangePassword: 1 }), false),
    );
    assert.equal(payload.user.mustChangePassword, true);
  });
});

describe("/api/auth/me access_reverify mapping", () => {
  it("maps access_reverify to 401 SESSION_ACCESS_REVERIFY_REQUIRED", () => {
    assert.throws(
      () =>
        resolveAuthFromValidation({
          ok: false,
          reason: "access_reverify",
          errorCode: AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED,
        }),
      (err: unknown) =>
        err instanceof AuthError &&
        err.status === 401 &&
        err.errorCode === AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED,
    );
  });

  it("maps access_reverify by reason alone", () => {
    assert.throws(
      () =>
        resolveAuthFromValidation({
          ok: false,
          reason: "access_reverify",
        }),
      (err: unknown) =>
        err instanceof AuthError &&
        err.errorCode === AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED,
    );
  });
});
