import { eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import {
  transitionTemporaryToApprovalHold,
  type LargeAttachmentLifecycleRecord,
} from "@/lib/mail/large-attachment/large-attachment-state-machine";

function mapLifecycleRow(row: typeof schema.mailLargeAttachmentLifecycle.$inferSelect): LargeAttachmentLifecycleRecord {
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

export async function transitionRevisionLargeAttachmentsForStaffSubmit(
  db: Database,
  input: {
    revisionId: string;
    firstSubmittedAt: string;
    now: string;
  },
): Promise<void> {
  const attachments = await db
    .select({
      storedFileId: schema.mailOutboundRevisionAttachments.storedFileId,
      deliveryMode: schema.mailOutboundRevisionAttachments.deliveryMode,
    })
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, input.revisionId));

  const largeStoredFileIds = attachments
    .filter((attachment) => attachment.deliveryMode === "large_attachment")
    .map((attachment) => attachment.storedFileId);
  if (largeStoredFileIds.length === 0) {
    return;
  }

  const lifecycleRows = await db
    .select()
    .from(schema.mailLargeAttachmentLifecycle)
    .where(inArray(schema.mailLargeAttachmentLifecycle.storedFileId, largeStoredFileIds));

  for (const row of lifecycleRows) {
    const current = mapLifecycleRow(row);
    const next = transitionTemporaryToApprovalHold(current, {
      firstSubmittedAt: input.firstSubmittedAt,
      now: input.now,
    });
    await db
      .update(schema.mailLargeAttachmentLifecycle)
      .set({
        status: next.status,
        approvalHoldStartedAt: next.approvalHoldStartedAt,
        approvalAbsoluteExpiresAt: next.approvalAbsoluteExpiresAt,
        updatedAt: next.updatedAt,
      })
      .where(eq(schema.mailLargeAttachmentLifecycle.id, row.id));
  }
}
