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
  evaluateAccessLoginEmailBinding,
  shouldRequireCloudflareAccess,
  validateAccessLoginWindowFromRequest,
} from "@/lib/auth/access-jwt";
import {
  enforceStaffAccessEmailBinding,
  STAFF_ACCESS_EMAIL_BINDING_OUTCOMES,
} from "@/lib/auth/staff-access-email-binding";
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
import {
  evaluateStaffLoginAccessEpochGate,
  getGlobalIdlePolicy,
} from "@/lib/settings/global-idle-exemption";

export const dynamic = "force-dynamic";

type LoginBody = {
  email?: string;
  password?: string;
};

type LoginCookieStore = Awaited<ReturnType<typeof cookies>>;

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

export async function handlePostLogin(
  request: Request,
  providedCookieStore?: LoginCookieStore,
) {
  const cookieStore = providedCookieStore ?? (await cookies());

  let accessCheckSkipped = true;
  let verifiedAccessEmail: string | null = null;
  let verifiedAccessIat: number | null = null;

  if (shouldRequireCloudflareAccess(request.headers)) {
    const accessWindow = await validateAccessLoginWindowFromRequest(request);
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

    accessCheckSkipped = accessWindow.skipped;
    verifiedAccessEmail = accessWindow.email ?? null;
    verifiedAccessIat = accessWindow.iat;

    const idleState = await resolveIdleReloginStateFromRequest(request);
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
  let isCrossAccountSuperAdminLogin = false;
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

  // Preserve the existing Admin Access-email behavior. Staff use the
  // separate binding flow only after successful CRM credential validation.
  if (user.role === "admin" && !accessCheckSkipped) {
    const binding = evaluateAccessLoginEmailBinding({
      verifiedAccessEmail,
      loginEmail: emailAttempted,
    });
    if (!binding.ok) {
      await writeLoginLog({
        userId: null,
        emailAttempted,
        success: false,
        failureReason: binding.reason,
        ipAddress,
        userAgent,
      });
      return Response.json(
        {
          error: "Unable to verify login permission",
          errorCode: AUTH_ERROR_CODES.UNAUTHORIZED_EMAIL,
        },
        { status: 401 },
      );
    }
    isCrossAccountSuperAdminLogin = binding.crossAccountSuperAdmin;
  }

  if (user.isActive !== 1) {
    return handleUnauthorizedEmail("user_disabled");
  }
  if (user.role === "staff" && user.deletedAt !== null) {
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

  if (user.role === "staff" && !accessCheckSkipped) {
    const bindingOutcome = await enforceStaffAccessEmailBinding(db, {
      userId: user.id,
      role: user.role,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      lockedUntil: user.lockedUntil,
      storedAccessEmail: user.cloudflareAccessEmail,
      loginEmail: emailAttempted,
      verifiedAccessEmail,
    });
    if (
      bindingOutcome !== STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.BOUND_NOW &&
      bindingOutcome !==
        STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ALREADY_BOUND_MATCH &&
      bindingOutcome !==
        STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.LEGACY_MATCH_UNBOUND
    ) {
      await writeLoginLog({
        userId: user.id,
        emailAttempted,
        success: false,
        failureReason: "access_email_binding_failed",
        ipAddress,
        userAgent,
      });
      return Response.json(
        {
          error: "目前的 Access 身份與此 CRM 帳戶不匹配，請聯絡管理員。",
          errorCode: AUTH_ERROR_CODES.UNAUTHORIZED_EMAIL,
        },
        { status: 401 },
      );
    }
  }

  await resetLoginFailures(user.id);
  await clearIpEmailRestriction(ipAddress);

  // Staff Access JWT iat must be after staff_access_reverify_after (when active).
  // Runs before any device DB writes or createSession / session cookie.
  const idlePolicy = await getGlobalIdlePolicy(db);
  const accessEpochGate = evaluateStaffLoginAccessEpochGate({
    role: user.role,
    accessCheckRequired: !accessCheckSkipped,
    accessIat: verifiedAccessIat,
    reverifyAfterUnixSec: idlePolicy.staffAccessReverifyAfter,
  });
  if (!accessEpochGate.allowed) {
    await writeLoginLog({
      userId: user.id,
      emailAttempted: email,
      success: false,
      failureReason: "access_reverify_required",
      ipAddress,
      userAgent,
    });
    return Response.json(
      {
        error: accessEpochGate.error,
        errorCode: AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED,
        redirect: getPostLogoutRedirectPath(),
      },
      { status: 401 },
    );
  }

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

    if (isCrossAccountSuperAdminLogin) {
      await writeAuditLog({
        userId: user.id,
        action: "auth.super_admin_cross_account_login",
        entityType: "session",
        entityId: user.id,
        ipAddress,
        userAgent,
        metadata: {
          targetUserId: user.id,
          targetRole: user.role,
          crossAccountLogin: true,
          verifiedSuperAdminAccess: true,
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

  if (isCrossAccountSuperAdminLogin) {
    await writeAuditLog({
      userId: user.id,
      action: "auth.super_admin_cross_account_login",
      entityType: "session",
      entityId: user.id,
      ipAddress,
      userAgent,
      metadata: {
        targetUserId: user.id,
        targetRole: user.role,
        crossAccountLogin: true,
        verifiedSuperAdminAccess: true,
      },
    });
  }

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

export async function POST(request: Request) {
  return handlePostLogin(request);
}
