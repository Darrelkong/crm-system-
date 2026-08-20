import { and, eq, isNull } from "drizzle-orm";
import type { User } from "../../../drizzle/schema/users";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import { getDb, type Database, schema } from "@/lib/db";

export type MailActorAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type MailActorContext = {
  userId: string;
  sessionId: string | null;
  crmRole: User["role"];
  mailAccessEnabled: boolean;
  adminGrants: MailAdminPermission[];
  audit: MailActorAuditContext;
};

export async function resolveMailActorContext(
  user: User,
  options?: {
    sessionId?: string | null;
    audit?: MailActorAuditContext;
    db?: Database;
  },
): Promise<MailActorContext> {
  const db = options?.db ?? getDb();

  const [accessRow] = await db
    .select({ isEnabled: schema.mailUserAccess.isEnabled })
    .from(schema.mailUserAccess)
    .where(eq(schema.mailUserAccess.userId, user.id))
    .limit(1);

  const grantRows = await db
    .select({ permission: schema.mailAdminGrants.permission })
    .from(schema.mailAdminGrants)
    .where(
      and(
        eq(schema.mailAdminGrants.userId, user.id),
        isNull(schema.mailAdminGrants.revokedAt),
      ),
    );

  return {
    userId: user.id,
    sessionId: options?.sessionId ?? null,
    crmRole: user.role,
    mailAccessEnabled: accessRow?.isEnabled === 1,
    adminGrants: grantRows.map((row) => row.permission),
    audit: options?.audit ?? {},
  };
}
