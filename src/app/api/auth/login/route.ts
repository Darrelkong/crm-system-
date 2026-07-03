import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, schema } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  getRequestMeta,
  getSessionCookieOptions,
} from "@/lib/auth/cookies";
import {
  getDeviceCookieExpiresAt,
  getDeviceCookieOptions,
  hashDeviceId,
  resolveDeviceIdFromRequest,
} from "@/lib/auth/device";
import {
  AUTH_ERROR_CODES,
} from "@/lib/auth/constants";
import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";
import {
  applyIdleReloginCookieUpdateToStore,
  resolveIdleReloginStateFromRequest,
} from "@/lib/auth/idle-relogin-cookie";
import {
  shouldRequireCloudflareAccess,
  validateAccessLoginWindowFromRequest,
} from "@/lib/auth/access-jwt";
import {
  isAccountLocked,
  recordFailedLogin,
  resetLoginFailures,
} from "@/lib/auth/lockout";
import {
  checkIpEmailRestriction,
  clearIpEmailRestriction,
  getClientIpFromRequest,
  recordUnauthorizedEmailForIp,
} from "@/lib/auth/ip-email-restriction";
import { writeLoginLog } from "@/lib/audit/login-log";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getPostLoginRedirectPath } from "@/lib/permissions/auth";
import {
  evaluateStaffDeviceLogin,
  recordAdminDeviceOnLogin,
} from "@/lib/devices/service";
import { DEVICE_AUDIT_ACTIONS } from "@/lib/devices/constants";

export const dynamic = "force-dynamic";

type LoginBody = {
  email?: string;
  password?: string;
};

const LOGIN_INVALID_CREDENTIALS = "邮箱或密码错误";
const LOGIN_ACCOUNT_LOCKED = "此账户已被锁定，请联系管理员处理。";

function normalizeClientIp(request: Request): string {
  return getClientIpFromRequest(request);
}

function ipRestrictionResponse(
  restrictedUntil: string,
  remainingSeconds: number,
) {
  return Response.json(
    {
      error: "Login temporarily restricted for this network",
      errorCode: AUTH_ERROR_CODES.IP_EMAIL_RESTRICTED,
      restrictedUntil,
      remainingSeconds,
    },
    { status: 429 },
  );
}

export async function POST(request: Request) {
  const cookieStore = await cookies();

  if (shouldRequireCloudflareAccess(request.headers)) {
    const accessWindow = validateAccessLoginWindowFromRequest(request);
    if (!accessWindow.ok) {
      return Response.json(
        {
          error: "Access verification expired",
          errorCode: AUTH_ERROR_CODES.ACCESS_VERIFICATION_EXPIRED,
          redirect: getPostLogoutRedirectPath(),
        },
        { status: 401 },
      );
    }

    const idleState = resolveIdleReloginStateFromRequest(request);
    if (idleState.cookieUpdate) {
      applyIdleReloginCookieUpdateToStore(
        cookieStore,
        idleState.cookieUpdate,
      );
    }
    if (idleState.requiresAccessReverify) {
      return Response.json(
        {
          error: "Access reverify required after repeated idle logout",
          errorCode: AUTH_ERROR_CODES.ACCESS_VERIFICATION_EXPIRED,
          redirect: getPostLogoutRedirectPath(),
        },
        { status: 403 },
      );
    }
  }

  const body = (await request.json()) as LoginBody;
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const ipAddress = normalizeClientIp(request);
  const { userAgent } = getRequestMeta(request);

  if (!email || !password) {
    return Response.json({ error: "请输入邮箱和密码" }, { status: 400 });
  }

  const emailAttempted = email;

  const ipRestriction = await checkIpEmailRestriction(ipAddress);
  if (ipRestriction.restricted) {
    return ipRestrictionResponse(
      ipRestriction.restrictedUntil,
      ipRestriction.remainingSeconds,
    );
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, emailAttempted))
    .limit(1);
  const user = rows[0];

  async function handleUnauthorizedEmail(
    failureReason: "user_not_found" | "user_disabled",
  ) {
    await writeLoginLog({
      userId: user?.id,
      emailAttempted: emailAttempted,
      success: false,
      failureReason,
      ipAddress,
      userAgent,
    });

    const attempt = await recordUnauthorizedEmailForIp(ipAddress);
    if (attempt.kind === "restricted") {
      return ipRestrictionResponse(
        attempt.restrictedUntil,
        attempt.remainingSeconds,
      );
    }

    return Response.json(
      {
        error: "Unable to verify login permission",
        errorCode: AUTH_ERROR_CODES.UNAUTHORIZED_EMAIL,
      },
      { status: 401 },
    );
  }

  if (!user) {
    return handleUnauthorizedEmail("user_not_found");
  }

  if (user.isActive !== 1) {
    return handleUnauthorizedEmail("user_disabled");
  }

  if (isAccountLocked(user)) {
    await writeLoginLog({
      userId: user.id,
      emailAttempted: emailAttempted,
      success: false,
      failureReason: "account_locked",
      ipAddress,
      userAgent,
    });
    return Response.json(
      {
        error: LOGIN_ACCOUNT_LOCKED,
        errorCode: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
      },
      { status: 423 },
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const lockout = await recordFailedLogin(user);
    await writeLoginLog({
      userId: user.id,
      emailAttempted: emailAttempted,
      success: false,
      failureReason: lockout.locked ? "account_locked" : "invalid_password",
      ipAddress,
      userAgent,
    });

    if (lockout.locked) {
      await writeAuditLog({
        userId: user.id,
        action: "auth.account_locked",
        entityType: "user",
        entityId: user.id,
        ipAddress,
        userAgent,
        metadata: {
          attempts: lockout.attempts,
          lockedUntil: lockout.lockedUntil,
        },
      });
      return Response.json(
        {
          error: LOGIN_ACCOUNT_LOCKED,
          errorCode: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
        },
        { status: 423 },
      );
    }

    return Response.json({ error: LOGIN_INVALID_CREDENTIALS }, { status: 401 });
  }

  await resetLoginFailures(user.id);
  await clearIpEmailRestriction(ipAddress);

  const { deviceId } = resolveDeviceIdFromRequest(request);
  const deviceIdHash = await hashDeviceId(deviceId);
  const deviceCookieExpiresAt = getDeviceCookieExpiresAt();

  if (user.role === "admin") {
    const deviceRecordId = await recordAdminDeviceOnLogin(user, deviceIdHash, {
      ipAddress,
      userAgent,
    });
    const { token, expiresAt } = await createSession(
      user.id,
      request,
      deviceIdHash,
    );
    cookieStore.set({
      ...getSessionCookieOptions(expiresAt),
      value: token,
    });
    cookieStore.set({
      ...getDeviceCookieOptions(deviceCookieExpiresAt),
      value: deviceId,
    });

    await writeLoginLog({
      userId: user.id,
      emailAttempted: email,
      success: true,
      ipAddress,
      userAgent,
    });

    await writeAuditLog({
      userId: user.id,
      action: "auth.login.success",
      entityType: "session",
      entityId: user.id,
      ipAddress,
      userAgent,
      metadata: { role: user.role, deviceRecordId },
    });

    return Response.json({
      ok: true,
      redirect: getPostLoginRedirectPath(user),
      mustChangePassword: user.mustChangePassword === 1,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    });
  }

  const deviceResult = await evaluateStaffDeviceLogin(
    user,
    deviceIdHash,
    { ipAddress, userAgent },
  );

  cookieStore.set({
    ...getDeviceCookieOptions(deviceCookieExpiresAt),
    value: deviceId,
  });

  if (!deviceResult.ok) {
    await writeLoginLog({
      userId: user.id,
      emailAttempted: email,
      success: false,
      failureReason: deviceResult.reason,
      ipAddress,
      userAgent,
    });

    return Response.json(
      {
        error: deviceResult.message,
        errorCode: deviceResult.errorCode,
      },
      { status: 403 },
    );
  }

  const { token, expiresAt } = await createSession(
    user.id,
    request,
    deviceIdHash,
  );
  cookieStore.set({
    ...getSessionCookieOptions(expiresAt),
    value: token,
  });

  await writeLoginLog({
    userId: user.id,
    emailAttempted: email,
    success: true,
    ipAddress,
    userAgent,
  });

  await writeAuditLog({
    userId: user.id,
    action: "auth.login.success",
    entityType: "session",
    entityId: user.id,
    ipAddress,
    userAgent,
    metadata: { role: user.role },
  });

  if (deviceResult.deviceRecordId) {
    await writeAuditLog({
      userId: user.id,
      action: DEVICE_AUDIT_ACTIONS.LOGIN_SUCCESS,
      entityType: "authorized_device",
      entityId: deviceResult.deviceRecordId,
      ipAddress,
      userAgent,
      metadata: {
        targetUserId: user.id,
        targetUserEmail: user.email,
        deviceRecordId: deviceResult.deviceRecordId,
      },
    });
  }

  return Response.json({
    ok: true,
    redirect: getPostLoginRedirectPath(user),
    mustChangePassword: user.mustChangePassword === 1,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
  });
}
