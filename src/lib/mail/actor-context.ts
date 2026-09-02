import { and, eq, isNull } from "drizzle-orm";
import type { User } from "../../../drizzle/schema/users";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import { getDb, type Database, schema } from "@/lib/db";
import {
  resolveEffectiveMailAccessState,
  type EffectiveMailAccessSnapshot,
} from "@/lib/mail/effective-mail-access-state";

export type MailActorAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type MailActorContext = {
  userId: string;
  sessionId: string | null;
  crmRole: User["role"];
  mailAccessEnabled: boolean;
  /** Database-backed effective state for production request actors. */
  effectiveMailAccess?: EffectiveMailAccessSnapshot;
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

  const mailAccessEnabled = accessRow?.isEnabled === 1;
  const effectiveMailAccess = await resolveEffectiveMailAccessState(db, {
    userId: user.id,
    userRole: user.role,
    mailAccessEnabled,
  });

  return {
    userId: user.id,
    sessionId: options?.sessionId ?? null,
    crmRole: user.role,
    mailAccessEnabled,
    effectiveMailAccess,
    adminGrants: grantRows.map((row) => row.permission),
    audit: options?.audit ?? {},
  };
}
