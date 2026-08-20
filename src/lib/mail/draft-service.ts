import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MailDraft } from "../../../drizzle/schema/mail-drafts";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { assertCanComposeFromIdentityInMailbox } from "@/lib/mail/compose-authorization";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import {
  assertBatchUpdateChanged,
  buildDraftVersionGuardedAuditInsert,
  isMailPostStateGuardError,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import { MailServiceError } from "@/lib/mail/errors";
import {
  toSafeDraftAttachmentView,
  toSafeDraftRecipientView,
  toSafeDraftView,
  type SafeDraftAttachmentView,
  type SafeDraftRecipientView,
  type SafeDraftView,
} from "@/lib/mail/draft-serialization";
import { sanitizeOptionalOutboundBodyHtml } from "@/lib/mail/outbound-body-html-sanitizer";
import {
  normalizeOutboundRecipientAddress,
  type OutboundRecipientInput,
} from "@/lib/mail/outbound-recipient-validation";
import { assertMailAccessEnabled } from "@/lib/permissions/mail";

export type DraftDetailView = SafeDraftView & {
  recipients: SafeDraftRecipientView[];
  attachments: SafeDraftAttachmentView[];
};

export type CreateDraftResult =
  | { created: true; item: DraftDetailView }
  | { created: false };

function buildDraftAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${input.auditId} AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_draft"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

export function hasMeaningfulDraftContent(input: {
  subject?: string;
  bodyText?: string;
  bodyHtml?: string | null;
  recipientCount?: number;
  attachmentCount?: number;
}): boolean {
  if (input.subject?.trim()) return true;
  if (input.bodyText?.trim()) return true;
  if (input.bodyHtml?.trim()) return true;
  if ((input.recipientCount ?? 0) > 0) return true;
  if ((input.attachmentCount ?? 0) > 0) return true;
  return false;
}

/** Persist only server-sanitized working HTML (same policy as Revision body). */
function sanitizeDraftBodyHtmlForPersistence(
  rawHtml: string | null | undefined,
): string | null {
  return sanitizeOptionalOutboundBodyHtml(rawHtml);
}

/**
 * Future draft child mutations (attachments add/remove/reorder/delivery-mode/
 * expiry/display filename) MUST bump autosave_version in the same atomic batch.
 */

async function findDraftById(
  db: Database,
  draftId: string,
): Promise<MailDraft | null> {
  const [row] = await db
    .select()
    .from(schema.mailDrafts)
    .where(eq(schema.mailDrafts.id, draftId))
    .limit(1);
  return row ?? null;
}

async function requireAuthorDraft(
  db: Database,
  actor: MailActorContext,
  draftId: string,
): Promise<MailDraft> {
  assertMailAccessEnabled(actor);
  const draft = await findDraftById(db, draftId);
  if (!draft || draft.discardedAt) {
    throw MailServiceError.notFound("Draft not found");
  }
  if (draft.authorUserId !== actor.userId) {
    throw MailServiceError.forbidden("Draft access denied");
  }
  return draft;
}

async function loadDraftDetail(
  db: Database,
  draft: MailDraft,
): Promise<DraftDetailView> {
  const recipients = await db
    .select()
    .from(schema.mailDraftRecipients)
    .where(eq(schema.mailDraftRecipients.draftId, draft.id))
    .orderBy(schema.mailDraftRecipients.sortOrder);

  const attachments = await db
    .select()
    .from(schema.mailDraftAttachments)
    .where(eq(schema.mailDraftAttachments.draftId, draft.id))
    .orderBy(schema.mailDraftAttachments.sortOrder);

  const attachmentViews: SafeDraftAttachmentView[] = [];
  for (const attachment of attachments) {
    const [stored] = await db
      .select()
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, attachment.storedFileId))
      .limit(1);
    attachmentViews.push(
      toSafeDraftAttachmentView(
        attachment,
        stored
          ? { mimeType: stored.mimeType, sizeBytes: stored.sizeBytes }
          : undefined,
      ),
    );
  }

  return {
    ...toSafeDraftView(draft),
    recipients: recipients.map(toSafeDraftRecipientView),
    attachments: attachmentViews,
  };
}

export async function listDrafts(
  db: Database,
  actor: MailActorContext,
): Promise<SafeDraftView[]> {
  assertMailAccessEnabled(actor);
  const rows = await db
    .select()
    .from(schema.mailDrafts)
    .where(
      and(
        eq(schema.mailDrafts.authorUserId, actor.userId),
        isNull(schema.mailDrafts.discardedAt),
      ),
    )
    .orderBy(schema.mailDrafts.updatedAt);
  return rows.map(toSafeDraftView);
}

export async function getDraft(
  db: Database,
  actor: MailActorContext,
  draftId: string,
): Promise<DraftDetailView> {
  const draft = await requireAuthorDraft(db, actor, draftId);
  return loadDraftDetail(db, draft);
}

export async function createDraft(
  db: Database,
  actor: MailActorContext,
  input: {
    senderIdentityId: string;
    mailboxId: string;
    subject?: string;
    bodyText?: string;
    bodyHtml?: string | null;
    sensitivity?: MailDraft["sensitivity"];
    composeMode?: MailDraft["composeMode"];
    recipients?: OutboundRecipientInput[];
  },
): Promise<CreateDraftResult> {
  if (input.composeMode && input.composeMode !== "new") {
    throw MailServiceError.validation(
      "Only new compose mode is supported in this phase",
    );
  }

  await assertCanComposeFromIdentityInMailbox(db, actor, {
    senderIdentityId: input.senderIdentityId,
    mailboxId: input.mailboxId,
  });

  const recipients = input.recipients ?? [];
  const normalizedRecipients = recipients.map((recipient, index) => ({
    ...recipient,
    address: normalizeOutboundRecipientAddress(recipient.address),
    sortOrder: recipient.sortOrder ?? index,
  }));

  const bodyHtml = sanitizeDraftBodyHtmlForPersistence(input.bodyHtml);

  if (
    !hasMeaningfulDraftContent({
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml,
      recipientCount: normalizedRecipients.length,
      attachmentCount: 0,
    })
  ) {
    return { created: false };
  }

  const now = new Date().toISOString();
  const draftId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  type BatchStatement = Parameters<Database["batch"]>[0][number];
  const statements: BatchStatement[] = [
    db.insert(schema.mailDrafts).values({
      id: draftId,
      authorUserId: actor.userId,
      mailboxId: input.mailboxId,
      senderIdentityId: input.senderIdentityId,
      subject: input.subject?.normalize("NFC") ?? "",
      bodyText: input.bodyText ?? "",
      bodyHtml,
      sensitivity: input.sensitivity ?? "normal",
      composeMode: "new",
      autosaveVersion: 0,
      lastSavedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
    buildDraftAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.draftCreated,
      entityId: draftId,
      metadata: {
        draftId,
        senderIdentityId: input.senderIdentityId,
        mailboxId: input.mailboxId,
        actorUserId: actor.userId,
        composeMode: "new",
      },
    }),
  ];

  for (const recipient of normalizedRecipients) {
    statements.push(
      db.insert(schema.mailDraftRecipients).values({
        id: crypto.randomUUID(),
        draftId,
        recipientType: recipient.recipientType,
        address: recipient.address,
        displayName: recipient.displayName?.normalize("NFC") ?? null,
        sortOrder: recipient.sortOrder ?? 0,
        createdAt: now,
      }),
    );
  }

  await runMailBatch(db, statements);

  const draft = await findDraftById(db, draftId);
  if (!draft) {
    throw MailServiceError.integrityConflict("Draft creation failed");
  }
  return { created: true, item: await loadDraftDetail(db, draft) };
}

export async function updateDraft(
  db: Database,
  actor: MailActorContext,
  input: {
    draftId: string;
    expectedAutosaveVersion: number;
    subject?: string;
    bodyText?: string;
    bodyHtml?: string | null;
    sensitivity?: MailDraft["sensitivity"];
  },
): Promise<DraftDetailView> {
  const draft = await requireAuthorDraft(db, actor, input.draftId);

  if (draft.senderIdentityId && draft.mailboxId) {
    await assertCanComposeFromIdentityInMailbox(db, actor, {
      senderIdentityId: draft.senderIdentityId,
      mailboxId: draft.mailboxId,
    });
  }

  const now = new Date().toISOString();
  const nextVersion = draft.autosaveVersion + 1;
  const auditId = crypto.randomUUID();

  const bodyHtml =
    input.bodyHtml === undefined
      ? draft.bodyHtml
      : sanitizeDraftBodyHtmlForPersistence(input.bodyHtml);

  try {
    await runMailBatch(db, [
      db
        .update(schema.mailDrafts)
        .set({
          subject:
            input.subject !== undefined
              ? input.subject.normalize("NFC")
              : draft.subject,
          bodyText:
            input.bodyText !== undefined ? input.bodyText : draft.bodyText,
          bodyHtml,
          sensitivity: input.sensitivity ?? draft.sensitivity,
          autosaveVersion: nextVersion,
          lastSavedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.mailDrafts.id, draft.id),
            eq(schema.mailDrafts.autosaveVersion, input.expectedAutosaveVersion),
            isNull(schema.mailDrafts.discardedAt),
          ),
        ),
      buildDraftVersionGuardedAuditInsert(
        db,
        actor,
        { draftId: draft.id, expectedAutosaveVersion: nextVersion },
        {
          auditId,
          now,
          action: MAIL_AUDIT_ACTIONS.draftUpdated,
          entityId: draft.id,
          entityType: "mail_draft",
          metadata: {
            draftId: draft.id,
            autosaveVersion: nextVersion,
            actorUserId: actor.userId,
          },
        },
      ),
    ]);
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion("Draft update conflict");
    }
    throw error;
  }

  const updated = await findDraftById(db, draft.id);
  if (!updated) {
    throw MailServiceError.integrityConflict("Draft update failed");
  }
  return loadDraftDetail(db, updated);
}

export async function addDraftRecipient(
  db: Database,
  actor: MailActorContext,
  input: OutboundRecipientInput & {
    draftId: string;
    expectedAutosaveVersion: number;
  },
): Promise<DraftDetailView> {
  const draft = await requireAuthorDraft(db, actor, input.draftId);
  if (draft.senderIdentityId && draft.mailboxId) {
    await assertCanComposeFromIdentityInMailbox(db, actor, {
      senderIdentityId: draft.senderIdentityId,
      mailboxId: draft.mailboxId,
    });
  }

  const address = normalizeOutboundRecipientAddress(input.address);
  const existing = await db
    .select()
    .from(schema.mailDraftRecipients)
    .where(eq(schema.mailDraftRecipients.draftId, draft.id));
  if (existing.some((row) => row.address === address)) {
    throw MailServiceError.validation(
      "Duplicate recipient address across To/Cc/Bcc",
    );
  }
  if (existing.length >= 50) {
    throw MailServiceError.validation("Maximum 50 unique recipients allowed");
  }

  const now = new Date().toISOString();
  const nextVersion = draft.autosaveVersion + 1;
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db.insert(schema.mailDraftRecipients).values({
        id: crypto.randomUUID(),
        draftId: draft.id,
        recipientType: input.recipientType,
        address,
        displayName: input.displayName?.normalize("NFC") ?? null,
        sortOrder: input.sortOrder ?? existing.length,
        createdAt: now,
      }),
      db
        .update(schema.mailDrafts)
        .set({
          autosaveVersion: nextVersion,
          lastSavedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.mailDrafts.id, draft.id),
            eq(schema.mailDrafts.autosaveVersion, input.expectedAutosaveVersion),
            isNull(schema.mailDrafts.discardedAt),
          ),
        ),
      buildDraftVersionGuardedAuditInsert(
        db,
        actor,
        { draftId: draft.id, expectedAutosaveVersion: nextVersion },
        {
          auditId,
          now,
          action: MAIL_AUDIT_ACTIONS.draftUpdated,
          entityId: draft.id,
          entityType: "mail_draft",
          metadata: {
            draftId: draft.id,
            autosaveVersion: nextVersion,
            recipientMutation: true,
            actorUserId: actor.userId,
          },
        },
      ),
    ]);
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion("Draft recipient add conflict");
    }
    throw error;
  }

  const refreshed = await findDraftById(db, draft.id);
  if (!refreshed) {
    throw MailServiceError.integrityConflict("Draft recipient add failed");
  }
  return loadDraftDetail(db, refreshed);
}

export async function discardDraft(
  db: Database,
  actor: MailActorContext,
  draftId: string,
): Promise<DraftDetailView> {
  const draft = await requireAuthorDraft(db, actor, draftId);
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailDrafts)
      .set({ discardedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.mailDrafts.id, draft.id),
          isNull(schema.mailDrafts.discardedAt),
        ),
      ),
    buildDraftAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.draftDiscarded,
      entityId: draft.id,
      metadata: { draftId: draft.id, actorUserId: actor.userId },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Draft discard conflict");

  const updated = await findDraftById(db, draft.id);
  if (!updated) {
    throw MailServiceError.integrityConflict("Draft discard failed");
  }
  return loadDraftDetail(db, updated);
}

export async function loadDraftGraphForRevision(
  db: Database,
  draftId: string,
) {
  const draft = await findDraftById(db, draftId);
  if (!draft || draft.discardedAt) {
    throw MailServiceError.notFound("Draft not found");
  }
  const recipients = await db
    .select()
    .from(schema.mailDraftRecipients)
    .where(eq(schema.mailDraftRecipients.draftId, draft.id))
    .orderBy(schema.mailDraftRecipients.sortOrder);
  const attachments = await db
    .select()
    .from(schema.mailDraftAttachments)
    .where(eq(schema.mailDraftAttachments.draftId, draft.id))
    .orderBy(schema.mailDraftAttachments.sortOrder);
  return { draft, recipients, attachments };
}
