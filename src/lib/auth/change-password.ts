import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, schema } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import {
  destroySession,
  getSessionTokenFromCookies,
} from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { writeAuditLog } from "@/lib/audit/audit-log";
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

export async function changeUserPassword(
  user: User,
  input: ChangePasswordInput,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<ChangePasswordFieldError[]> {
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
    return errors;
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
    return errors;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(input.newPassword);

  await db
    .update(schema.users)
    .set({
      passwordHash,
      mustChangePassword: 0,
      passwordChangedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.users.id, user.id));

  const token = await getSessionTokenFromCookies();
  if (token) {
    await destroySession(token);
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
  });

  await writeAuditLog({
    userId: user.id,
    action: "auth.password_changed",
    entityType: "user",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return [];
}

export function userMustChangePassword(user: User): boolean {
  return user.mustChangePassword === 1;
}
