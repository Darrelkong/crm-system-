export const dynamic = "force-dynamic";

import { eq } from "drizzle-orm";
import { getRequestMeta } from "@/lib/auth/cookies";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import {
  getSecondaryIdleCodeState,
  getStoredHash,
  IDLE_EXEMPT_DURATION_MS,
  IDLE_EXEMPT_LOCKOUT_MINUTES,
  IDLE_EXEMPT_MAX_ATTEMPTS,
  rotateCodeAfterUse,
  verifySecondaryIdleCode,
} from "@/lib/auth/secondary-idle-code";
import { getSessionTokenFromCookies, validateSessionToken } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { getDb, schema } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const { ipAddress, userAgent } = getRequestMeta(request);

    // --- 1. Validate current session ---
    const token = await getSessionTokenFromCookies();
    if (!token) {
      throw new AuthError(401, "未登录", undefined, AUTH_ERROR_CODES.UNAUTHENTICATED);
    }

    const validation = await validateSessionToken(token, { touch: true });
    if (!validation.ok) {
      // Surface the appropriate AuthError so authErrorResponse handles it correctly
      if (validation.errorCode === AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED) {
        throw new AuthError(401, "session idle expired", undefined, AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED);
      }
      if (validation.errorCode === AUTH_ERROR_CODES.SESSION_REVOKED) {
        throw new AuthError(401, "session revoked", undefined, AUTH_ERROR_CODES.SESSION_REVOKED);
      }
      if (validation.errorCode === AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED) {
        throw new AuthError(401, "device revoked", undefined, AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED);
      }
      throw new AuthError(401, "未登录", undefined, AUTH_ERROR_CODES.UNAUTHENTICATED);
    }

    const { sessionId, user } = validation.session;
    const db = getDb();

    // --- 2. Check feature enabled ---
    const state = await getSecondaryIdleCodeState(db);
    if (!state.enabled || !state.hasCode) {
      return Response.json(
        { error: "該操作已被限制，請聯絡管理員。" },
        { status: 403 },
      );
    }

    // --- 3. Check lockout for this session ---
    const sessionRow = await db
      .select({
        idleExemptAttempts: schema.sessions.idleExemptAttempts,
        idleExemptLockedUntil: schema.sessions.idleExemptLockedUntil,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    const nowIso = new Date().toISOString();
    const row = sessionRow[0];

    if (row?.idleExemptLockedUntil && row.idleExemptLockedUntil > nowIso) {
      return Response.json(
        { error: "驗證次數過多，請稍後再試。" },
        { status: 429 },
      );
    }

    // --- 4. Parse and validate the submitted code ---
    const body = (await request.json()) as { code?: unknown };
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!code) {
      return Response.json({ error: "驗證碼不能為空。" }, { status: 400 });
    }

    const storedHash = await getStoredHash(db);
    const isCorrect = await verifySecondaryIdleCode(code, storedHash);

    if (!isCorrect) {
      // Increment attempt counter, possibly lock session
      const currentAttempts = row?.idleExemptAttempts ?? 0;
      const newAttempts = currentAttempts + 1;

      if (newAttempts >= IDLE_EXEMPT_MAX_ATTEMPTS) {
        const lockedUntil = new Date(
          Date.now() + IDLE_EXEMPT_LOCKOUT_MINUTES * 60 * 1000,
        ).toISOString();
        await db
          .update(schema.sessions)
          .set({
            idleExemptAttempts: newAttempts,
            idleExemptLockedUntil: lockedUntil,
          })
          .where(eq(schema.sessions.id, sessionId));

        await writeAuditLog({
          userId: user.id,
          action: "secondary_idle_code.session_locked",
          entityType: "session",
          entityId: sessionId,
          ipAddress,
          userAgent,
          metadata: { attempts: newAttempts },
        });
      } else {
        await db
          .update(schema.sessions)
          .set({ idleExemptAttempts: newAttempts })
          .where(eq(schema.sessions.id, sessionId));
      }

      return Response.json(
        { error: "驗證碼錯誤，請重試。" },
        { status: 401 },
      );
    }

    // --- 5. Correct code: grant 8-hour idle exemption on this session only ---
    const exemptUntil = new Date(Date.now() + IDLE_EXEMPT_DURATION_MS).toISOString();

    await db
      .update(schema.sessions)
      .set({
        idleExemptUntil: exemptUntil,
        idleExemptAttempts: 0,
        idleExemptLockedUntil: null,
      })
      .where(eq(schema.sessions.id, sessionId));

    // Rotate code hash — new code is generated but plaintext is discarded.
    // Admin must visit settings to see a new plaintext code.
    await rotateCodeAfterUse(db);

    await writeAuditLog({
      userId: user.id,
      action: "secondary_idle_code.activated",
      entityType: "session",
      entityId: sessionId,
      ipAddress,
      userAgent,
      metadata: { exemptUntil },
    });

    return Response.json({ ok: true, exemptUntil });
  } catch (error) {
    return authErrorResponse(error);
  }
}
