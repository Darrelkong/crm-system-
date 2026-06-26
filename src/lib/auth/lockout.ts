import { eq } from "drizzle-orm";
import * as schema from "../../../drizzle/schema";
import { getDb } from "@/lib/db";
import {
  LOCKOUT_PERSISTENT_UNTIL,
  LOCKOUT_THRESHOLD,
} from "@/lib/auth/constants";
import { revokeAllSessionsForUser } from "@/lib/auth/session-policy";
import type { User } from "../../../drizzle/schema/users";

export function isLoginLockoutExempt(user: User): boolean {
  return user.role === "admin";
}

export function isAccountLocked(user: User): boolean {
  if (isLoginLockoutExempt(user)) {
    return false;
  }
  return user.lockedUntil != null;
}

export function getLockoutRemainingMinutes(user: User, now = Date.now()): number {
  if (!user.lockedUntil || user.lockedUntil === LOCKOUT_PERSISTENT_UNTIL) {
    return 0;
  }
  const remainingMs = new Date(user.lockedUntil).getTime() - now;
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.ceil(remainingMs / 60_000);
}

export async function recordFailedLogin(user: User): Promise<{
  locked: boolean;
  attempts: number;
  lockedUntil: string | null;
}> {
  if (isLoginLockoutExempt(user)) {
    return {
      locked: false,
      attempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    };
  }

  const db = getDb();
  const nowIso = new Date().toISOString();

  const attempts = user.failedLoginAttempts + 1;
  let lockedUntil: string | null = user.lockedUntil;
  let locked = false;

  if (attempts >= LOCKOUT_THRESHOLD) {
    lockedUntil = nowIso;
    locked = true;
  }

  await db
    .update(schema.users)
    .set({
      failedLoginAttempts: attempts,
      lockedUntil,
      updatedAt: nowIso,
    })
    .where(eq(schema.users.id, user.id));

  if (locked) {
    await revokeAllSessionsForUser(db, user.id, nowIso);
  }

  return { locked, attempts, lockedUntil };
}

export async function resetLoginFailures(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.users)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.users.id, userId));
}
