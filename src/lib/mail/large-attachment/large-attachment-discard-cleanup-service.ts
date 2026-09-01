import { eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import { deleteLargeAttachmentObjectIfPresent } from "@/lib/mail/large-attachment/large-attachment-remove-service";
import {
  transitionToDeleted,
  type LargeAttachmentLifecycleRecord,
} from "@/lib/mail/large-attachment/large-attachment-state-machine";
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

/** Explicit draft discard — temporary large attachments become cleanup-eligible. */
export async function cleanupTemporaryLargeAttachmentsForDiscardedDraft(
  db: Database,
  draftId: string,
  now: string,
): Promise<void> {
  const attachments = await db
    .select({
      storedFileId: schema.mailDraftAttachments.storedFileId,
      deliveryMode: schema.mailDraftAttachments.deliveryMode,
    })
    .from(schema.mailDraftAttachments)
    .where(eq(schema.mailDraftAttachments.draftId, draftId));

  const largeStoredFileIds = attachments
    .filter((attachment) => attachment.deliveryMode === "large_attachment")
    .map((attachment) => attachment.storedFileId);
  if (largeStoredFileIds.length === 0) {
    return;
  }
  assertLargeAttachmentRuntimeReady();

  const lifecycleRows = await db
    .select()
    .from(schema.mailLargeAttachmentLifecycle)
    .where(inArray(schema.mailLargeAttachmentLifecycle.storedFileId, largeStoredFileIds));

  const storedFiles = await db
    .select({
      id: schema.mailStoredFiles.id,
      storageKey: schema.mailStoredFiles.storageKey,
    })
    .from(schema.mailStoredFiles)
    .where(inArray(schema.mailStoredFiles.id, largeStoredFileIds));

  for (const row of lifecycleRows) {
    if (row.status !== "temporary") {
      continue;
    }
    const next = transitionToDeleted(mapLifecycleRow(row), {
      now,
      reason: "draft_discarded",
    });
    await db
      .update(schema.mailLargeAttachmentLifecycle)
      .set({
        status: next.status,
        deletedAt: next.deletedAt,
        deleteReason: next.deleteReason,
        updatedAt: next.updatedAt,
      })
      .where(eq(schema.mailLargeAttachmentLifecycle.id, row.id));
  }

  await Promise.all(
    storedFiles.map(async (file) => {
      if (file.storageKey) {
        await deleteLargeAttachmentObjectIfPresent(file.storageKey);
      }
    }),
  );
}
