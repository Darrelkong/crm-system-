import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getDb, schema } from "@/lib/db";
import { getSessionExpiresAt, getRequestMeta } from "@/lib/auth/cookies";
import {
  AUTH_ERROR_CODES,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/constants";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/token";
import type { User } from "../../../drizzle/schema/users";
import {
  getIdleLogoutMinutes,
  isSessionIdleExpired,
  isSessionRevoked,
  revokeExistingSessionsForLogin,
  revokeSessionById,
  revokeSessionByTokenHash,
  shouldTouchSessionActivity,
  touchSessionActivity,
} from "@/lib/auth/session-policy";
import { isDeviceApprovedForSession } from "@/lib/devices/service";

export type SessionWithUser = {
  sessionId: string;
  user: User;
};

export type SessionValidationResult =
  | { ok: true; session: SessionWithUser }
  | {
      ok: false;
      reason:
        | "missing"
        | "invalid"
        | "idle_expired"
        | "revoked"
        | "inactive_user"
        | "device_revoked";
      errorCode?: string;
    };

function getSessionDb() {
  return getDb();
}

export async function createSession(
  userId: string,
  request: Request,
  deviceIdHash: string,
): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const db = getSessionDb();
  await revokeExistingSessionsForLogin(db, userId);

  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const expiresAt = getSessionExpiresAt();
  const now = new Date().toISOString();
  const { ipAddress, userAgent } = getRequestMeta(request);
  const sessionId = crypto.randomUUID();

  await db.insert(schema.sessions).values({
    id: sessionId,
    userId,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
    lastActivityAt: now,
    revokedAt: null,
    ipAddress,
    userAgent,
    deviceIdHash,
    createdAt: now,
  });

  return { token, expiresAt, sessionId };
}

export async function validateSessionToken(
  token: string,
  options?: { touch?: boolean },
): Promise<SessionValidationResult> {
  const db = getSessionDb();
  const tokenHash = await hashSessionToken(token);
  const nowIso = new Date().toISOString();

  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      session: schema.sessions,
      user: schema.users,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.tokenHash, tokenHash))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      reason: "invalid",
      errorCode: AUTH_ERROR_CODES.SESSION_INVALID,
    };
  }

  if (row.session.expiresAt <= nowIso) {
    await revokeSessionById(db, row.sessionId, nowIso);
    return {
      ok: false,
      reason: "invalid",
      errorCode: AUTH_ERROR_CODES.SESSION_INVALID,
    };
  }

  if (row.user.isActive !== 1) {
    return { ok: false, reason: "inactive_user" };
  }

  if (row.session.deviceIdHash) {
    const deviceApproved = await isDeviceApprovedForSession(
      row.user.id,
      row.session.deviceIdHash,
      db,
    );
    if (!deviceApproved) {
      if (!isSessionRevoked(row.session)) {
        await revokeSessionById(db, row.sessionId, nowIso);
      }
      return {
        ok: false,
        reason: "device_revoked",
        errorCode: AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED,
      };
    }
  }

  if (isSessionRevoked(row.session)) {
    return {
      ok: false,
      reason: "revoked",
      errorCode: AUTH_ERROR_CODES.SESSION_REVOKED,
    };
  }

  const idleMinutes = await getIdleLogoutMinutes(db);
  if (isSessionIdleExpired(row.session, idleMinutes)) {
    await revokeSessionById(db, row.sessionId, nowIso);
    return {
      ok: false,
      reason: "idle_expired",
      errorCode: AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED,
    };
  }

  if (options?.touch !== false && shouldTouchSessionActivity(row.session)) {
    await touchSessionActivity(db, row.sessionId, nowIso);
  }

  return {
    ok: true,
    session: { sessionId: row.sessionId, user: row.user },
  };
}

export async function getSessionByToken(
  token: string,
  options?: { touch?: boolean },
): Promise<SessionWithUser | null> {
  const result = await validateSessionToken(token, options);
  return result.ok ? result.session : null;
}

export async function destroySession(token: string): Promise<void> {
  const db = getSessionDb();
  const tokenHash = await hashSessionToken(token);
  await revokeSessionByTokenHash(db, tokenHash);
}

export async function getSessionTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function getCurrentSession(
  options?: { touch?: boolean },
): Promise<SessionWithUser | null> {
  const token = await getSessionTokenFromCookies();
  if (!token) {
    return null;
  }
  return getSessionByToken(token, options);
}

export async function getCurrentUser(
  options?: { touch?: boolean },
): Promise<User | null> {
  const session = await getCurrentSession(options);
  return session?.user ?? null;
}

export async function validateSessionFromRequest(
  request: NextRequest,
  options?: { touch?: boolean },
): Promise<SessionValidationResult> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!token) {
    return { ok: false, reason: "missing" };
  }
  return validateSessionToken(token, options);
}

import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";

export { getPostLogoutRedirectPath };
