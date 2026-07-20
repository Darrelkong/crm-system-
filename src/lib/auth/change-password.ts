import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, schema } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import {
  destroySession,
  getSessionTokenFromCookies,
  validateSessionToken,
} from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { writeAuditLog } from "@/lib/audit/audit-log";
import {
  completeForcedPasswordChangeConsumingEligibility,
  completeInitialStaffActivation,
  InitialActivationConflictError,
} from "@/lib/auth/initial-staff-activation";
import {
  countApprovedDevicesForUser,
  getAuthorizedDeviceByUserAndHash,
  getDeviceAuthorizationLimit,
  isDeviceAuthorizationEnabled,
} from "@/lib/devices/queries";
import { canCreateInitialActivationRestrictedSession } from "@/lib/devices/initial-device-auto-approval";
import type { User } from "../../../drizzle/schema/users";

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ChangePasswordFieldError = {
  field: string;
  code: string;
  message: string;
};

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; fieldErrors: ChangePasswordFieldError[] }
  | {
      ok: false;
      conflict: true;
      errorCode: string;
      message: string;
    };

async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
  });
}

async function destroyCurrentSessionAndCookie(): Promise<void> {
  const token = await getSessionTokenFromCookies();
  if (token) {
    await destroySession(token);
  }
  await clearSessionCookie();
}

async function applyStandardPasswordChange(
  user: User,
  passwordHash: string,
  now: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
  options?: { consumeEligibility?: boolean },
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.users)
    .set({
      passwordHash,
      mustChangePassword: 0,
      passwordChangedAt: now,
      updatedAt: now,
      ...(options?.consumeEligibility
        ? { initialDeviceAutoApprovalEligible: 0 }
        : {}),
    })
    .where(eq(schema.users.id, user.id));

  await destroyCurrentSessionAndCookie();

  await writeAuditLog({
    userId: user.id,
    action: "auth.password_changed",
    entityType: "user",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata:
      user.mustChangePassword === 1
        ? {
            forced: true,
            ...(options?.consumeEligibility
              ? { eligibilityConsumed: true }
              : {}),
          }
        : null,
  });
}

export async function changeUserPassword(
  user: User,
  input: ChangePasswordInput,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<ChangePasswordResult> {
  const errors: ChangePasswordFieldError[] = [];

  if (!input.currentPassword) {
    errors.push({
      field: "currentPassword",
      code: "CURRENT_PASSWORD_REQUIRED",
      message: "请输入当前密码",
    });
  }
  if (!input.newPassword) {
    errors.push({
      field: "newPassword",
      code: "NEW_PASSWORD_REQUIRED",
      message: "请输入新密码",
    });
  }
  if (!input.confirmPassword) {
    errors.push({
      field: "confirmPassword",
      code: "CONFIRM_PASSWORD_REQUIRED",
      message: "请再次输入新密码",
    });
  }
  if (errors.length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  if (input.newPassword !== input.confirmPassword) {
    errors.push({
      field: "confirmPassword",
      code: "PASSWORD_CONFIRM_MISMATCH",
      message: "两次输入的新密码不一致",
    });
  }

  const validCurrent = await verifyPassword(
    input.currentPassword,
    user.passwordHash,
  );
  if (!validCurrent) {
    errors.push({
      field: "currentPassword",
      code: "CURRENT_PASSWORD_INVALID",
      message: "当前密码不正确",
    });
  }

  if (input.newPassword === input.currentPassword) {
    errors.push({
      field: "newPassword",
      code: "PASSWORD_SAME_AS_OLD",
      message: "新密码不能与当前密码相同",
    });
  }

  const policy = validatePasswordPolicy(input.newPassword);
  if (!policy.valid) {
    errors.push({
      field: "newPassword",
      code: policy.code ?? "PASSWORD_POLICY_FAILED",
      message: policy.message ?? "新密码不符合安全要求",
    });
  }

  if (errors.length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(input.newPassword);

  // Fresh user + session binding from DB (never trust client device claims).
  const freshUserRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  const freshUser = freshUserRows[0];
  if (!freshUser || freshUser.isActive !== 1) {
    return {
      ok: false,
      conflict: true,
      errorCode: "INITIAL_ACTIVATION_STATE_CHANGED",
      message: "啟用狀態已更新，請重新登入後再試。",
    };
  }

  const token = await getSessionTokenFromCookies();
  const sessionValidation = token
    ? await validateSessionToken(token, { touch: false })
    : null;
  const session =
    sessionValidation?.ok === true ? sessionValidation.session : null;

  const wasForced = freshUser.mustChangePassword === 1;
  const wasEligible = freshUser.initialDeviceAutoApprovalEligible === 1;
  const deviceAuthEnabled = await isDeviceAuthorizationEnabled(db);

  // Branch A: first-device auto-approval activation.
  if (
    freshUser.role === "staff" &&
    wasForced &&
    wasEligible &&
    deviceAuthEnabled &&
    session?.deviceIdHash
  ) {
    const device = await getAuthorizedDeviceByUserAndHash(
      freshUser.id,
      session.deviceIdHash,
      db,
    );
    const approvedCount = await countApprovedDevicesForUser(freshUser.id, db);
    const deviceLimit = await getDeviceAuthorizationLimit(db);

    if (
      device &&
      canCreateInitialActivationRestrictedSession({
        role: freshUser.role,
        mustChangePassword: freshUser.mustChangePassword,
        initialDeviceAutoApprovalEligible:
          freshUser.initialDeviceAutoApprovalEligible,
        deviceAuthorizationEnabled: true,
        deviceStatus: device.status,
        deviceBelongsToUser: device.userId === freshUser.id,
        approvedCount,
        deviceLimit,
      })
    ) {
      try {
        await completeInitialStaffActivation({
          userId: freshUser.id,
          sessionId: session.sessionId,
          deviceIdHash: session.deviceIdHash,
          passwordHash,
          now,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
        await clearSessionCookie();
        return { ok: true };
      } catch (error) {
        if (error instanceof InitialActivationConflictError) {
          return {
            ok: false,
            conflict: true,
            errorCode: error.errorCode,
            message: error.message,
          };
        }
        throw error;
      }
    }

    // Pending restricted session but state no longer allows auto-approve
    // (rejected / revoked / hash mismatch / etc.) while still eligible+forced:
    // do not silently fall through to a password change that would leave the
    // restricted pending session usable without resolving activation.
    if (device?.status === "pending" || !device) {
      return {
        ok: false,
        conflict: true,
        errorCode: "INITIAL_ACTIVATION_STATE_CHANGED",
        message: "啟用狀態已更新，請重新登入後再試。",
      };
    }
  }

  // Branch B: device auth off + forced + eligible → consume eligibility, no approve.
  if (
    freshUser.role === "staff" &&
    wasForced &&
    wasEligible &&
    !deviceAuthEnabled
  ) {
    try {
      await completeForcedPasswordChangeConsumingEligibility({
        userId: freshUser.id,
        sessionId: session?.sessionId ?? null,
        passwordHash,
        now,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        deviceAuthorizationEnabled: false,
      });
      await clearSessionCookie();
      return { ok: true };
    } catch (error) {
      if (error instanceof InitialActivationConflictError) {
        return {
          ok: false,
          conflict: true,
          errorCode: error.errorCode,
          message: error.message,
        };
      }
      throw error;
    }
  }

  // Branch C: ordinary / remaining forced password changes.
  // If still eligible after a forced change (e.g. already has approved device
  // from admin), consume eligibility on success.
  await applyStandardPasswordChange(freshUser, passwordHash, now, meta, {
    consumeEligibility: wasForced && wasEligible,
  });

  return { ok: true };
}

export function userMustChangePassword(user: User): boolean {
  return user.mustChangePassword === 1;
}
