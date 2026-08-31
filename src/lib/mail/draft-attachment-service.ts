import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_ATTACHMENTS_R2_BUCKET_NAME } from "@/lib/mail/attachments-env";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import {
  normalizeAttachmentFilename,
  validateComposeAttachmentCandidate,
} from "@/lib/mail/compose-attachment-policy";
import {
  loadDraftDetail,
  requireAuthorDraft,
  resolveActorUser,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertBatchUpdateChanged,
  buildDraftVersionGuardedAuditInsert,
  isMailPostStateGuardError,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import type { OutboundAttachmentStore } from "@/lib/mail/outbound-attachment-store";
import { removeLargeDraftAttachment } from "@/lib/mail/large-attachment/large-attachment-remove-service";

async function loadDraftAttachmentTotals(
  db: Database,
  draftId: string,
): Promise<{ count: number; totalBytes: number }> {
  const attachments = await db
    .select({
      storedFileId: schema.mailDraftAttachments.storedFileId,
    })
    .from(schema.mailDraftAttachments)
    .where(eq(schema.mailDraftAttachments.draftId, draftId));

  if (attachments.length === 0) {
    return { count: 0, totalBytes: 0 };
  }

  const fileIds = attachments.map((row) => row.storedFileId);
  const files = await db
    .select({ sizeBytes: schema.mailStoredFiles.sizeBytes })
    .from(schema.mailStoredFiles)
    .where(inArray(schema.mailStoredFiles.id, fileIds));

  return {
    count: attachments.length,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
  };
}

export async function addDraftAttachment(
  db: Database,
  actor: MailActorContext,
  attachmentStore: OutboundAttachmentStore,
  input: {
    draftId: string;
    expectedAutosaveVersion: number;
    bytes: Uint8Array;
    originalFilename: string;
    mimeType: string;
  },
): Promise<DraftDetailView> {
  const draft = await requireAuthorDraft(db, actor, input.draftId);
  const filename = normalizeAttachmentFilename(input.originalFilename);
  const mimeType =
    input.mimeType.trim().toLowerCase() || "application/octet-stream";

  const totals = await loadDraftAttachmentTotals(db, draft.id);
  const policyIssue = validateComposeAttachmentCandidate({
    filename,
    mimeType,
    sizeBytes: input.bytes.byteLength,
    existingAttachmentCount: totals.count,
    existingTotalBytes: totals.totalBytes,
  });
  if (policyIssue) {
    throw MailServiceError.validation(policyIssue.message, {
      issueCode: policyIssue.code,
    });
  }

  const stored = await attachmentStore.put({
    bytes: input.bytes,
    originalFilename: filename,
    mimeType,
  });

  const now = new Date().toISOString();
  const nextVersion = draft.autosaveVersion + 1;
  const draftAttachmentId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  const existingAttachments = await db
    .select({ sortOrder: schema.mailDraftAttachments.sortOrder })
    .from(schema.mailDraftAttachments)
    .where(eq(schema.mailDraftAttachments.draftId, draft.id));
  const nextSortOrder =
    existingAttachments.length > 0
      ? Math.max(...existingAttachments.map((row) => row.sortOrder)) + 1
      : 0;

  try {
    const results = await runMailBatch(db, [
      db.insert(schema.mailStoredFiles).values({
        id: stored.storedFileId,
        contentHash: stored.contentHash,
        originalFilename: stored.originalFilename,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        storageProvider: stored.storageProvider,
        storageBucket: stored.storageBucket || MAIL_ATTACHMENTS_R2_BUCKET_NAME,
        storageKey: stored.storageKey,
        createdByUserId: actor.userId,
        securityScanStatus: "clean",
        securityScannedAt: now,
        createdAt: now,
      }),
      db.insert(schema.mailDraftAttachments).values({
        id: draftAttachmentId,
        draftId: draft.id,
        storedFileId: stored.storedFileId,
        displayFilename: filename,
        sortOrder: nextSortOrder,
        deliveryMode: "direct_attachment",
        secureExpiryDays: null,
        createdAt: now,
        updatedAt: now,
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
          action: MAIL_AUDIT_ACTIONS.draftAttachmentAdded,
          entityId: draft.id,
          entityType: "mail_draft",
          metadata: {
            draftId: draft.id,
            draftAttachmentId,
            storedFileId: stored.storedFileId,
            filename,
            sizeBytes: stored.sizeBytes,
            actorUserId: actor.userId,
          },
        },
      ),
    ]);
    assertBatchUpdateChanged(results, 2, "Draft attachment add conflict");
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion("Draft attachment add conflict");
    }
    throw error;
  }

  const [updated] = await db
    .select()
    .from(schema.mailDrafts)
    .where(eq(schema.mailDrafts.id, draft.id))
    .limit(1);
  if (!updated) {
    throw MailServiceError.integrityConflict("Draft attachment add failed");
  }
  const user = await resolveActorUser(actor);
  return loadDraftDetail(db, updated, user);
}

export async function removeDraftAttachment(
  db: Database,
  actor: MailActorContext,
  input: {
    draftId: string;
    attachmentId: string;
    expectedAutosaveVersion: number;
  },
): Promise<DraftDetailView> {
  const draft = await requireAuthorDraft(db, actor, input.draftId);

  const [attachment] = await db
    .select()
    .from(schema.mailDraftAttachments)
    .where(
      and(
        eq(schema.mailDraftAttachments.id, input.attachmentId),
        eq(schema.mailDraftAttachments.draftId, draft.id),
      ),
    )
    .limit(1);

  if (!attachment) {
    throw MailServiceError.notFound("Draft attachment not found");
  }

  if (attachment.deliveryMode === "large_attachment") {
    return removeLargeDraftAttachment(db, actor, input);
  }

  const now = new Date().toISOString();
  const nextVersion = draft.autosaveVersion + 1;
  const auditId = crypto.randomUUID();

  try {
    const results = await runMailBatch(db, [
      db
        .delete(schema.mailDraftAttachments)
        .where(eq(schema.mailDraftAttachments.id, attachment.id)),
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
          action: MAIL_AUDIT_ACTIONS.draftAttachmentRemoved,
          entityId: draft.id,
          entityType: "mail_draft",
          metadata: {
            draftId: draft.id,
            draftAttachmentId: attachment.id,
            storedFileId: attachment.storedFileId,
            actorUserId: actor.userId,
          },
        },
      ),
    ]);
    assertBatchUpdateChanged(results, 1, "Draft attachment remove conflict");
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion("Draft attachment remove conflict");
    }
    throw error;
  }

  const [updated] = await db
    .select()
    .from(schema.mailDrafts)
    .where(eq(schema.mailDrafts.id, draft.id))
    .limit(1);
  if (!updated) {
    throw MailServiceError.integrityConflict("Draft attachment remove failed");
  }
  const user = await resolveActorUser(actor);
  return loadDraftDetail(db, updated, user);
}
