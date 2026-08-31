import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import { resolveMailAttachmentDownloadFilename } from "@/lib/mail/mail-attachment-download-content-disposition";
import {
  assertStoredFileRelationshipIntegrity,
} from "@/lib/mail/mail-attachment-download-service";
import { assertEffectiveMailAccess, hasMailOutboundApprovalReview } from "@/lib/permissions/mail";
import { LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME } from "@/lib/mail/large-attachment/large-attachment-constants";
import { evaluateLargeAttachmentReviewerDownloadEligibility } from "@/lib/mail/large-attachment/large-attachment-reviewer-download-eligibility";
import type { LargeAttachmentLifecycleRecord } from "@/lib/mail/large-attachment/large-attachment-state-machine";

export type DownloadableOutboundRevisionAttachment = {
  attachmentId: string;
  revisionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  storageBucket: string;
  deliveryMode: "direct_attachment" | "large_attachment" | "secure_file";
};

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

async function assertOutboundRevisionAttachmentReadAccess(
  db: Database,
  actor: MailActorContext,
  revision: { id: string; revisionChainId: string; createdByUserId: string },
): Promise<void> {
  assertEffectiveMailAccess(actor);
  if (revision.createdByUserId === actor.userId) {
    return;
  }
  if (!hasMailOutboundApprovalReview(actor)) {
    throw MailServiceError.forbidden("Outbound revision attachment access denied");
  }
  const [approval] = await db
    .select({ id: schema.mailOutboundApprovals.id })
    .from(schema.mailOutboundApprovals)
    .where(eq(schema.mailOutboundApprovals.revisionChainId, revision.revisionChainId))
    .limit(1);
  if (!approval) {
    throw MailServiceError.forbidden("Outbound revision attachment access denied");
  }
}

function assertDirectAttachmentDownloadEligibility(input: {
  deliveryMode: string;
  securityScanStatus: string;
}): void {
  if (input.deliveryMode !== "direct_attachment") {
    return;
  }
  if (input.securityScanStatus !== "clean") {
    throw MailServiceError.notFound();
  }
}

function assertLargeAttachmentDownloadEligibility(input: {
  deliveryMode: string;
  lifecycle: LargeAttachmentLifecycleRecord | null;
  sizeBytes: number;
  trustNowIso: string;
}): void {
  if (input.deliveryMode !== "large_attachment") {
    return;
  }
  const eligibility = evaluateLargeAttachmentReviewerDownloadEligibility({
    lifecycle: input.lifecycle,
    sizeBytes: input.sizeBytes,
    trustNowIso: input.trustNowIso,
  });
  if (!eligibility.ok) {
    throw MailServiceError.notFound();
  }
}

export async function resolveDownloadableOutboundRevisionAttachment(
  db: Database,
  actor: MailActorContext,
  revisionId: string,
  attachmentId: string,
  options?: { trustNowIso?: string },
): Promise<DownloadableOutboundRevisionAttachment> {
  const [attachment] = await db
    .select()
    .from(schema.mailOutboundRevisionAttachments)
    .where(
      and(
        eq(schema.mailOutboundRevisionAttachments.id, attachmentId),
        eq(schema.mailOutboundRevisionAttachments.revisionId, revisionId),
      ),
    )
    .limit(1);

  if (!attachment) {
    throw MailServiceError.notFound();
  }

  const [revision] = await db
    .select({
      id: schema.mailOutboundRevisions.id,
      revisionChainId: schema.mailOutboundRevisions.revisionChainId,
      createdByUserId: schema.mailOutboundRevisions.createdByUserId,
    })
    .from(schema.mailOutboundRevisions)
    .where(eq(schema.mailOutboundRevisions.id, revisionId))
    .limit(1);

  if (!revision) {
    throw MailServiceError.notFound();
  }

  await assertOutboundRevisionAttachmentReadAccess(db, actor, revision);

  const [storedFile] = await db
    .select()
    .from(schema.mailStoredFiles)
    .where(eq(schema.mailStoredFiles.id, attachment.storedFileId))
    .limit(1);

  assertStoredFileRelationshipIntegrity(attachment, storedFile);

  const trustNowIso = options?.trustNowIso ?? new Date().toISOString();
  let lifecycle: LargeAttachmentLifecycleRecord | null = null;
  if (attachment.deliveryMode === "large_attachment") {
    const [lifecycleRow] = await db
      .select()
      .from(schema.mailLargeAttachmentLifecycle)
      .where(eq(schema.mailLargeAttachmentLifecycle.storedFileId, attachment.storedFileId))
      .limit(1);
    lifecycle = lifecycleRow ? mapLifecycleRow(lifecycleRow) : null;
  }

  assertDirectAttachmentDownloadEligibility({
    deliveryMode: attachment.deliveryMode,
    securityScanStatus: storedFile.securityScanStatus,
  });
  assertLargeAttachmentDownloadEligibility({
    deliveryMode: attachment.deliveryMode,
    lifecycle,
    sizeBytes: attachment.sizeBytes,
    trustNowIso,
  });

  if (attachment.deliveryMode === "secure_file") {
    throw MailServiceError.notFound();
  }

  return {
    attachmentId: attachment.id,
    revisionId: revision.id,
    filename: resolveMailAttachmentDownloadFilename({
      displayFilename: attachment.displayFilename,
      originalFilename: attachment.originalFilename,
    }),
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    storageKey: storedFile.storageKey,
    storageBucket:
      attachment.deliveryMode === "large_attachment"
        ? LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME
        : storedFile.storageBucket,
    deliveryMode: attachment.deliveryMode,
  };
}
