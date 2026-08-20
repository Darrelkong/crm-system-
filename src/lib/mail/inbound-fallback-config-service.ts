import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MailMailbox } from "../../../drizzle/schema/mail-mailboxes";
import {
  MAIL_COMPANY_CONFIG_SINGLETON_ID,
} from "../../../drizzle/schema/mail-company-config";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import { findMailboxById } from "@/lib/mail/mailbox-service";
import { runMailBatch } from "@/lib/mail/guarded-batch";
import {
  assertMailInboundFallbackConfigManagement,
} from "@/lib/permissions/mail";

export type InboundFallbackMailboxUnusableReason =
  | "not_configured"
  | "mailbox_missing"
  | "mailbox_not_active"
  | "mailbox_not_shared";

export type InboundFallbackMailboxConfigView = {
  configured: boolean;
  mailboxId: string | null;
  usable: boolean;
  unusableReason: InboundFallbackMailboxUnusableReason | null;
  mailboxStatus: MailMailbox["status"] | null;
  mailboxType: MailMailbox["mailboxType"] | null;
};

function evaluateFallbackMailbox(
  configured: boolean,
  mailbox: MailMailbox | null,
): InboundFallbackMailboxConfigView {
  if (!configured) {
    return {
      configured: false,
      mailboxId: null,
      usable: false,
      unusableReason: "not_configured",
      mailboxStatus: null,
      mailboxType: null,
    };
  }

  const mailboxId = mailbox?.id ?? null;
  if (!mailbox) {
    return {
      configured: true,
      mailboxId: null,
      usable: false,
      unusableReason: "mailbox_missing",
      mailboxStatus: null,
      mailboxType: null,
    };
  }

  if (mailbox.status !== "active") {
    return {
      configured: true,
      mailboxId: mailbox.id,
      usable: false,
      unusableReason: "mailbox_not_active",
      mailboxStatus: mailbox.status,
      mailboxType: mailbox.mailboxType,
    };
  }

  if (mailbox.mailboxType !== "shared") {
    return {
      configured: true,
      mailboxId: mailbox.id,
      usable: false,
      unusableReason: "mailbox_not_shared",
      mailboxStatus: mailbox.status,
      mailboxType: mailbox.mailboxType,
    };
  }

  return {
    configured: true,
    mailboxId: mailbox.id,
    usable: true,
    unusableReason: null,
    mailboxStatus: mailbox.status,
    mailboxType: mailbox.mailboxType,
  };
}

async function assertValidFallbackMailboxTarget(
  db: Database,
  mailboxId: string,
): Promise<MailMailbox> {
  const mailbox = await findMailboxById(db, mailboxId);
  if (!mailbox) {
    throw MailServiceError.notFound("Fallback mailbox not found");
  }
  if (mailbox.status !== "active") {
    throw MailServiceError.validation(
      "Inbound fallback mailbox must be active",
      { status: mailbox.status },
    );
  }
  if (mailbox.mailboxType !== "shared") {
    throw MailServiceError.validation(
      "Inbound fallback mailbox must be a shared company mailbox",
      { mailboxType: mailbox.mailboxType },
    );
  }
  return mailbox;
}

/**
 * Internal resolver — does not guess another mailbox when config is missing/invalid.
 */
export async function getInboundFallbackMailboxConfig(
  db: Database,
): Promise<InboundFallbackMailboxConfigView> {
  const [row] = await db
    .select()
    .from(schema.mailCompanyConfig)
    .where(eq(schema.mailCompanyConfig.id, MAIL_COMPANY_CONFIG_SINGLETON_ID))
    .limit(1);

  if (!row) {
    return evaluateFallbackMailbox(false, null);
  }

  const mailbox = await findMailboxById(db, row.inboundFallbackMailboxId);
  return evaluateFallbackMailbox(true, mailbox);
}

export async function setInboundFallbackMailbox(
  db: Database,
  actor: MailActorContext,
  input: { mailboxId: string },
): Promise<InboundFallbackMailboxConfigView> {
  assertMailInboundFallbackConfigManagement(actor);

  const mailbox = await assertValidFallbackMailboxTarget(db, input.mailboxId);
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const [existing] = await db
    .select()
    .from(schema.mailCompanyConfig)
    .where(eq(schema.mailCompanyConfig.id, MAIL_COMPANY_CONFIG_SINGLETON_ID))
    .limit(1);

  const oldMailboxId = existing?.inboundFallbackMailboxId ?? null;

  await runMailBatch(db, [
    db
      .insert(schema.mailCompanyConfig)
      .values({
        id: MAIL_COMPANY_CONFIG_SINGLETON_ID,
        inboundFallbackMailboxId: mailbox.id,
        updatedByUserId: actor.userId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.mailCompanyConfig.id,
        set: {
          inboundFallbackMailboxId: mailbox.id,
          updatedByUserId: actor.userId,
          updatedAt: now,
        },
      }),
    buildInsertAuditLogSelectStatement(
      db,
      sql`
        SELECT
          ${auditId} AS id,
          ${actor.userId} AS user_id,
          ${MAIL_AUDIT_ACTIONS.inboundFallbackUpdated} AS action,
          ${"mail_company_config"} AS entity_type,
          ${MAIL_COMPANY_CONFIG_SINGLETON_ID} AS entity_id,
          ${actor.audit.ipAddress ?? null} AS ip_address,
          ${actor.audit.userAgent ?? null} AS user_agent,
          ${JSON.stringify({
            oldMailboxId,
            newMailboxId: mailbox.id,
            actorUserId: actor.userId,
          })} AS metadata,
          ${now} AS created_at
      `,
    ),
  ]);

  return getInboundFallbackMailboxConfig(db);
}
