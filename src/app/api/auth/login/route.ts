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
  AUTH_ERROR_CODES,
} from "@/lib/auth/constants";
import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";
import {
  shouldRequireCloudflareAccess,
  validateAccessLoginWindowFromRequest,
} from "@/lib/auth/access-jwt";
import {
  getLockoutRemainingMinutes,
  isAccountLocked,
  recordFailedLogin,
  resetLoginFailures,
} from "@/lib/auth/lockout";
import { writeLoginLog } from "@/lib/audit/login-log";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getRoleDashboardPath } from "@/lib/permissions/auth";

export const dynamic = "force-dynamic";

type LoginBody = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
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
  }

  const body = (await request.json()) as LoginBody;
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const { ipAddress, userAgent } = getRequestMeta(request);

  if (!email || !password) {
    return Response.json({ error: "请输入邮箱和密码" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  const user = rows[0];

  if (!user) {
    await writeLoginLog({
      emailAttempted: email,
      success: false,
      failureReason: "user_not_found",
      ipAddress,
      userAgent,
    });
    return Response.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  if (user.isActive !== 1) {
    await writeLoginLog({
      userId: user.id,
      emailAttempted: email,
      success: false,
      failureReason: "user_disabled",
      ipAddress,
      userAgent,
    });
    return Response.json({ error: "账号已禁用" }, { status: 403 });
  }

  if (isAccountLocked(user)) {
    await writeLoginLog({
      userId: user.id,
      emailAttempted: email,
      success: false,
      failureReason: "account_locked",
      ipAddress,
      userAgent,
    });
    return Response.json(
      {
        error: `账号已锁定，请 ${getLockoutRemainingMinutes(user)} 分钟后再试`,
      },
      { status: 423 },
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const lockout = await recordFailedLogin(user);
    await writeLoginLog({
      userId: user.id,
      emailAttempted: email,
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
        { error: "连续登录失败次数过多，账号已锁定 30 分钟" },
        { status: 423 },
      );
    }

    return Response.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  await resetLoginFailures(user.id);

  const { token, expiresAt } = await createSession(user.id, request);
  const cookieStore = await cookies();
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

  return Response.json({
    ok: true,
    redirect: getRoleDashboardPath(user.role),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
  });
}
