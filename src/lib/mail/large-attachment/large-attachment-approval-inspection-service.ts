import { eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import { MailServiceError } from "@/lib/mail/errors";
import { evaluateLargeAttachmentReviewerDownloadEligibility } from "@/lib/mail/large-attachment/large-attachment-reviewer-download-eligibility";
import type { LargeAttachmentLifecycleRecord } from "@/lib/mail/large-attachment/large-attachment-state-machine";

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

/**
 * Approval must fail closed when a frozen revision large attachment cannot be
 * inspected under reviewer attachment policy.
 */
export async function assertRevisionLargeAttachmentsInspectableForApproval(
  db: Database,
  revisionId: string,
  trustNowIso: string = new Date().toISOString(),
): Promise<void> {
  const attachments = await db
    .select({
      id: schema.mailOutboundRevisionAttachments.id,
      deliveryMode: schema.mailOutboundRevisionAttachments.deliveryMode,
      storedFileId: schema.mailOutboundRevisionAttachments.storedFileId,
      sizeBytes: schema.mailOutboundRevisionAttachments.sizeBytes,
    })
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, revisionId));

  for (const attachment of attachments) {
    if (attachment.deliveryMode !== "large_attachment") {
      continue;
    }

    const [lifecycleRow] = await db
      .select()
      .from(schema.mailLargeAttachmentLifecycle)
      .where(eq(schema.mailLargeAttachmentLifecycle.storedFileId, attachment.storedFileId))
      .limit(1);

    const eligibility = evaluateLargeAttachmentReviewerDownloadEligibility({
      lifecycle: lifecycleRow ? mapLifecycleRow(lifecycleRow) : null,
      sizeBytes: attachment.sizeBytes,
      trustNowIso,
    });

    if (!eligibility.ok) {
      throw MailServiceError.validation(
        "Large attachment cannot be inspected for approval",
        {
          issueCode: eligibility.code,
          revisionAttachmentId: attachment.id,
        },
      );
    }
  }
}
