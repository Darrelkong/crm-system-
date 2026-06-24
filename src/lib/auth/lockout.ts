import { eq } from "drizzle-orm";
import * as schema from "../../../drizzle/schema";
import { getDb } from "@/lib/db";
import { LOCKOUT_DURATION_MS, LOCKOUT_THRESHOLD } from "@/lib/auth/constants";
import type { User } from "../../../drizzle/schema/users";

export function isAccountLocked(user: User, now = Date.now()): boolean {
  if (!user.lockedUntil) {
    return false;
  }
  return new Date(user.lockedUntil).getTime() > now;
}

export function getLockoutRemainingMinutes(
  user: User,
  now = Date.now(),
): number {
  if (!user.lockedUntil) {
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
  const db = getDb();
  const nowIso = new Date().toISOString();

  let attempts = user.failedLoginAttempts;
  let lockedUntil: string | null = user.lockedUntil;

  if (lockedUntil && !isAccountLocked(user)) {
    attempts = 0;
    lockedUntil = null;
  }

  attempts += 1;

  let locked = false;
  if (attempts >= LOCKOUT_THRESHOLD) {
    lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
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
