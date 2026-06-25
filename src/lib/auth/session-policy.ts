import { and, eq, gt, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { Session } from "../../../drizzle/schema/sessions";
import {
  AUTH_ERROR_CODES,
  SESSION_ACTIVITY_TOUCH_INTERVAL_MS,
} from "@/lib/auth/constants";
import { getEffectiveSettings } from "@/lib/settings/effective";

export class SessionPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionPolicyError";
  }
}

export function isSessionRevoked(session: Pick<Session, "revokedAt">): boolean {
  return session.revokedAt != null;
}

export function getSessionLastActivityIso(
  session: Pick<Session, "lastActivityAt" | "createdAt">,
): string {
  return session.lastActivityAt ?? session.createdAt;
}

export function isSessionIdleExpired(
  session: Pick<Session, "lastActivityAt" | "createdAt">,
  idleMinutes: number,
  nowMs = Date.now(),
): boolean {
  const lastActivity = getSessionLastActivityIso(session);
  const idleMs = idleMinutes * 60 * 1000;
  return nowMs - new Date(lastActivity).getTime() > idleMs;
}

export function shouldTouchSessionActivity(
  session: Pick<Session, "lastActivityAt" | "createdAt">,
  nowMs = Date.now(),
): boolean {
  const lastActivity = getSessionLastActivityIso(session);
  return (
    nowMs - new Date(lastActivity).getTime() >= SESSION_ACTIVITY_TOUCH_INTERVAL_MS
  );
}

type Db = DrizzleD1Database<typeof schema>;

export async function revokeSessionById(
  db: Db,
  sessionId: string,
  now = new Date().toISOString(),
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        isNull(schema.sessions.revokedAt),
      ),
    );
}

export async function revokeSessionByTokenHash(
  db: Db,
  tokenHash: string,
  now = new Date().toISOString(),
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.sessions.tokenHash, tokenHash),
        isNull(schema.sessions.revokedAt),
      ),
    );
}

export async function revokeAllSessionsForUser(
  db: Db,
  userId: string,
  now = new Date().toISOString(),
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
      ),
    );
}

export async function touchSessionActivity(
  db: Db,
  sessionId: string,
  now = new Date().toISOString(),
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ lastActivityAt: now })
    .where(eq(schema.sessions.id, sessionId));
}

export async function getActiveSessionsForUser(
  db: Db,
  userId: string,
  nowIso = new Date().toISOString(),
): Promise<Session[]> {
  return db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, nowIso),
      ),
    );
}

export async function cleanupIdleSessionsForUser(
  db: Db,
  userId: string,
  idleMinutes: number,
): Promise<number> {
  const now = new Date().toISOString();
  const sessions = await getActiveSessionsForUser(db, userId, now);
  let revoked = 0;
  for (const session of sessions) {
    if (isSessionIdleExpired(session, idleMinutes)) {
      await revokeSessionById(db, session.id, now);
      revoked += 1;
    }
  }
  return revoked;
}

export async function assertSingleSessionAllowed(
  db: Db,
  userId: string,
  idleMinutes: number,
  excludeSessionId?: string,
): Promise<void> {
  await cleanupIdleSessionsForUser(db, userId, idleMinutes);
  const remaining = await getActiveSessionsForUser(db, userId);
  const blocking = remaining.filter((s) => s.id !== excludeSessionId);
  if (blocking.length > 0) {
    throw new SessionPolicyError(
      AUTH_ERROR_CODES.SINGLE_SESSION_ACTIVE,
      "single session active",
    );
  }
}

export async function getIdleLogoutMinutes(db?: Db): Promise<number> {
  if (db) {
    const settings = await getEffectiveSettings(db);
    return settings.inactivityLogoutMinutes;
  }
  const settings = await getEffectiveSettings();
  return settings.inactivityLogoutMinutes;
}
