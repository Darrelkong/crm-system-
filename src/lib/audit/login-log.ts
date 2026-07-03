import { getDb } from "@/lib/db";
import { schema } from "@/lib/db";

type LoginLogInput = {
  userId?: string | null;
  emailAttempted: string;
  success: boolean;
  failureReason?:
    | "invalid_password"
    | "user_not_found"
    | "user_disabled"
    | "account_locked"
    | "new_pending"
    | "pending"
    | "rejected"
    | "revoked"
    | "limit_reached"
    | string
    | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function writeLoginLog(input: LoginLogInput): Promise<void> {
  const db = getDb();
  await db.insert(schema.loginLogs).values({
    id: crypto.randomUUID(),
    userId: input.userId ?? null,
    emailAttempted: input.emailAttempted,
    success: input.success ? 1 : 0,
    failureReason: input.failureReason ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    createdAt: new Date().toISOString(),
  });
}
