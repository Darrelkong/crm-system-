import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAccountLocked,
  isLoginLockoutExempt,
} from "@/lib/auth/lockout";
import {
  LOCKOUT_PERSISTENT_UNTIL,
  LOCKOUT_THRESHOLD,
} from "@/lib/auth/constants";
import type { User } from "../../../drizzle/schema/users";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "staff@example.com",
    displayName: "Staff User",
    passwordHash: "hash",
    role: "staff",
    isActive: 1,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: 0,
    passwordChangedAt: null,
    passwordResetAt: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("login lockout", () => {
  it("uses a threshold of 3 failed attempts", () => {
    assert.equal(LOCKOUT_THRESHOLD, 3);
  });

  it("exempts admin accounts from auto lockout", () => {
    const admin = makeUser({
      role: "admin",
      failedLoginAttempts: 5,
      lockedUntil: LOCKOUT_PERSISTENT_UNTIL,
    });
    assert.equal(isLoginLockoutExempt(admin), true);
    assert.equal(isAccountLocked(admin), false);
  });

  it("treats staff with locked_until as locked", () => {
    const staff = makeUser({
      lockedUntil: "2026-06-24T10:00:00.000Z",
      failedLoginAttempts: 3,
    });
    assert.equal(isAccountLocked(staff), true);
  });

  it("treats legacy sentinel locked_until as locked for staff", () => {
    const staff = makeUser({
      lockedUntil: LOCKOUT_PERSISTENT_UNTIL,
      failedLoginAttempts: 3,
    });
    assert.equal(isAccountLocked(staff), true);
  });

  it("does not treat unlocked staff as locked", () => {
    const staff = makeUser({ failedLoginAttempts: 2 });
    assert.equal(isAccountLocked(staff), false);
  });
});
