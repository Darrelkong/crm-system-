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
import { isDeviceAllowedForStaffSession } from "@/lib/devices/service";
import {
  getGlobalIdlePolicy,
  isStaffSessionBlockedByReverifyEpoch,
} from "@/lib/settings/global-idle-exemption";
import { recordAuthValidationPerf } from "@/lib/auth/validation-perf";
import { perfNow } from "@/lib/customers/customer-detail-perf";

export type SessionWithUser = {
  sessionId: string;
  user: User;
  /** Bound device hash from the session row; null when unset. */
  deviceIdHash: string | null;
};

export type SessionValidationResult =
  | {
      ok: true;
      session: SessionWithUser;
      globalIdleTimeoutExempt: boolean;
    }
  | {
      ok: false;
      reason:
        | "missing"
        | "invalid"
        | "idle_expired"
        | "revoked"
        | "inactive_user"
        | "device_revoked"
        | "access_reverify";
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

  const sessionQuery = db
    .select({
      sessionId: schema.sessions.id,
      session: schema.sessions,
      user: schema.users,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.tokenHash, tokenHash))
    .limit(1);
  const policyQuery = getGlobalIdlePolicy(db);

  const parallelStart = perfNow();
  const [sessionTimed, policyTimed] = await Promise.all([
    (async () => {
      const start = perfNow();
      const rows = await sessionQuery;
      return { rows, durationMs: perfNow() - start };
    })(),
    (async () => {
      const start = perfNow();
      const policy = await policyQuery;
      return { policy, durationMs: perfNow() - start };
    })(),
  ]);
  const initialParallelMs = perfNow() - parallelStart;
  const rows = sessionTimed.rows;
  const policy = policyTimed.policy;

  let authDeviceMs = 0;
  let authTouchMs = 0;

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

  // Staff sessions created at/before the reverify epoch must complete Access again.
  // Do not set revokedAt — this is distinct from SESSION_REVOKED / other-device login.
  if (
    isStaffSessionBlockedByReverifyEpoch(
      row.user.role,
      row.session.createdAt,
      policy.staffAccessReverifyAfter,
    )
  ) {
    return {
      ok: false,
      reason: "access_reverify",
      errorCode: AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED,
    };
  }

  // Admin accounts are never blocked by device authorization status.
  if (row.session.deviceIdHash && row.user.role !== "admin") {
    const deviceStart = perfNow();
    const deviceAllowed = await isDeviceAllowedForStaffSession(
      row.user,
      row.session.deviceIdHash,
      db,
    );
    authDeviceMs = perfNow() - deviceStart;
    if (!deviceAllowed) {
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
  const sessionIdleExempt =
    row.session.idleExemptUntil != null &&
    row.session.idleExemptUntil > nowIso;
  const skipIdle =
    policy.globalIdleTimeoutExempt || sessionIdleExempt;
  if (!skipIdle && isSessionIdleExpired(row.session, idleMinutes)) {
    await revokeSessionById(db, row.sessionId, nowIso);
    return {
      ok: false,
      reason: "idle_expired",
      errorCode: AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED,
    };
  }

  if (options?.touch !== false && shouldTouchSessionActivity(row.session)) {
    const touchStart = perfNow();
    await touchSessionActivity(db, row.sessionId, nowIso);
    authTouchMs = perfNow() - touchStart;
  }

  recordAuthValidationPerf({
    authSessionReadMs: sessionTimed.durationMs,
    authPolicyReadMs: policyTimed.durationMs,
    authInitialParallelMs: initialParallelMs,
    authDeviceMs,
    authTouchMs,
  });

  return {
    ok: true,
    session: {
      sessionId: row.sessionId,
      user: row.user,
      deviceIdHash: row.session.deviceIdHash ?? null,
    },
    globalIdleTimeoutExempt: policy.globalIdleTimeoutExempt,
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
