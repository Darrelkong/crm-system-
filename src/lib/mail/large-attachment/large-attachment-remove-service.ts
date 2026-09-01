import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
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
import {
  transitionToDeleted,
  type LargeAttachmentLifecycleRecord,
} from "@/lib/mail/large-attachment/large-attachment-state-machine";
import {
  createLargeAttachmentS3Client,
} from "@/lib/mail/large-attachment/large-attachment-r2-s3-client";
import { resolveLargeAttachmentR2Env } from "@/lib/mail/large-attachment/large-attachment-r2-env";
import { assertLargeAttachmentRuntimeReady } from "@/lib/mail/large-attachment/large-attachment-readiness";

function mapLifecycleRow(
  row: typeof schema.mailLargeAttachmentLifecycle.$inferSelect,
): LargeAttachmentLifecycleRecord {
  return {
    id: row.id,
    storedFileId: row.storedFileId,
    status: row.status,
    uploadedAt: row.uploadedAt,
    temporaryExpiresAt: row.temporaryExpiresAt,
    approvalHoldStartedAt: row.approvalHoldStartedAt,
    approvalAbsoluteExpiresAt: row.approvalAbsoluteExpiresAt,
    sentAt: row.sentAt,
    recipientExpiresAt: row.recipientExpiresAt,
    deletedAt: row.deletedAt,
    deleteReason: row.deleteReason,
    downloadTokenHash: row.downloadTokenHash,
    downloadCount: row.downloadCount,
    lastDownloadedAt: row.lastDownloadedAt,
    declaredContentHash: row.declaredContentHash,
    storageVersion: row.storageVersion,
    storageEtag: row.storageEtag,
    finalizedAt: row.finalizedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function deleteLargeAttachmentObjectIfPresent(
  storageKey: string,
): Promise<"deleted" | "already_missing" | "skipped"> {
  try {
    const env = resolveLargeAttachmentR2Env();
    const client = createLargeAttachmentS3Client(env);
    await client.send(
      new DeleteObjectCommand({
        Bucket: env.bucketName,
        Key: storageKey,
      }),
    );
    return "deleted";
  } catch {
    return "skipped";
  }
}

export async function removeLargeDraftAttachment(
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
  if (!attachment || attachment.deliveryMode !== "large_attachment") {
    throw MailServiceError.notFound("Large draft attachment not found");
  }
  assertLargeAttachmentRuntimeReady();

  const [stored] = await db
    .select()
    .from(schema.mailStoredFiles)
    .where(eq(schema.mailStoredFiles.id, attachment.storedFileId))
    .limit(1);
  const [lifecycleRow] = stored
    ? await db
        .select()
        .from(schema.mailLargeAttachmentLifecycle)
        .where(eq(schema.mailLargeAttachmentLifecycle.storedFileId, stored.id))
        .limit(1)
    : [];

  const now = new Date().toISOString();
  const nextVersion = draft.autosaveVersion + 1;
  const auditId = crypto.randomUUID();
  const lifecycleUpdate =
    lifecycleRow &&
    lifecycleRow.status !== "deleted" &&
    lifecycleRow.status !== "sent"
      ? transitionToDeleted(mapLifecycleRow(lifecycleRow), {
          now,
          reason: "user_removed_from_draft",
        })
      : null;

  try {
    const statements = [
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
            deliveryMode: "large_attachment",
            actorUserId: actor.userId,
          },
        },
      ),
    ];
    const results = await runMailBatch(db, statements);
    assertBatchUpdateChanged(results, 1, "Large attachment remove conflict");
    if (lifecycleUpdate && lifecycleRow) {
      await db
        .update(schema.mailLargeAttachmentLifecycle)
        .set({
          status: lifecycleUpdate.status,
          deletedAt: lifecycleUpdate.deletedAt,
          deleteReason: lifecycleUpdate.deleteReason,
          updatedAt: lifecycleUpdate.updatedAt,
        })
        .where(eq(schema.mailLargeAttachmentLifecycle.id, lifecycleRow.id));
    }
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion("Large attachment remove conflict");
    }
    throw error;
  }

  if (stored?.storageKey) {
    await deleteLargeAttachmentObjectIfPresent(stored.storageKey);
  }

  const user = await resolveActorUser(actor);
  const updated = await requireAuthorDraft(db, actor, draft.id);
  return loadDraftDetail(db, updated, user);
}
