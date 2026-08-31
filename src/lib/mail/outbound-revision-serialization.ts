import type { MailOutboundRevision } from "../../../drizzle/schema/mail-outbound-revisions";
import type { MailOutboundRevisionRecipient } from "../../../drizzle/schema/mail-outbound-revision-recipients";
import type { MailOutboundRevisionAttachment } from "../../../drizzle/schema/mail-outbound-revision-attachments";
import type { MailStoredFile } from "../../../drizzle/schema/mail-stored-files";
import type { MailDeliveryMode } from "../../../drizzle/schema/mail-draft-attachments";
import type { MailLargeAttachmentLifecycle } from "../../../drizzle/schema/mail-large-attachment-lifecycle";
import { evaluateLargeAttachmentReviewerDownloadEligibility } from "@/lib/mail/large-attachment/large-attachment-reviewer-download-eligibility";
import type { LargeAttachmentLifecycleRecord } from "@/lib/mail/large-attachment/large-attachment-state-machine";
import { resolveMailAttachmentDownloadFilename } from "@/lib/mail/mail-attachment-download-content-disposition";

export type SafeOutboundRevisionRecipientView = {
  recipientType: MailOutboundRevisionRecipient["recipientType"];
  address: string;
  displayName: string | null;
  sortOrder: number;
};

export type SafeOutboundRevisionAttachmentView = {
  id: string;
  displayFilename: string;
  mimeType: string;
  sizeBytes: number;
  deliveryMode: MailDeliveryMode;
  sortOrder: number;
  downloadAvailable: boolean;
};

export type SafeOutboundRevisionView = {
  id: string;
  revisionChainId: string;
  revisionNumber: number;
  parentRevisionId: string | null;
  sourceDraftId: string | null;
  revisionKind: MailOutboundRevision["revisionKind"];
  mailboxId: string;
  senderIdentityId: string;
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string;
  bodyText: string;
  bodyHtmlSanitized: string | null;
  sensitivity: MailOutboundRevision["sensitivity"];
  composeMode: MailOutboundRevision["composeMode"];
  signatureSnapshotId: string;
  contentHash: string;
  hashVersion: number;
  createdAt: string;
  createdByUserId: string;
};

export type SafeOutboundRevisionDetailView = SafeOutboundRevisionView & {
  recipients: SafeOutboundRevisionRecipientView[];
  attachments: SafeOutboundRevisionAttachmentView[];
};

export function toSafeOutboundRevisionAttachmentView(
  attachment: MailOutboundRevisionAttachment,
  storedFile: Pick<MailStoredFile, "securityScanStatus"> | null | undefined,
  options?: {
    lifecycle?: MailLargeAttachmentLifecycle | null;
    trustNowIso?: string;
  },
): SafeOutboundRevisionAttachmentView {
  const downloadAvailable = resolveOutboundRevisionAttachmentDownloadAvailable({
    attachment,
    storedFile,
    lifecycle: options?.lifecycle,
    trustNowIso: options?.trustNowIso,
  });

  return {
    id: attachment.id,
    displayFilename: resolveMailAttachmentDownloadFilename({
      displayFilename: attachment.displayFilename,
      originalFilename: attachment.originalFilename,
    }),
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    deliveryMode: attachment.deliveryMode,
    sortOrder: attachment.sortOrder,
    downloadAvailable,
  };
}

function mapLifecycleForReviewerDownload(
  lifecycle: MailLargeAttachmentLifecycle | null | undefined,
): LargeAttachmentLifecycleRecord | null {
  if (!lifecycle) {
    return null;
  }
  return {
    id: lifecycle.id,
    storedFileId: lifecycle.storedFileId,
    status: lifecycle.status,
    uploadedAt: lifecycle.uploadedAt,
    temporaryExpiresAt: lifecycle.temporaryExpiresAt,
    approvalHoldStartedAt: lifecycle.approvalHoldStartedAt,
    approvalAbsoluteExpiresAt: lifecycle.approvalAbsoluteExpiresAt,
    sentAt: lifecycle.sentAt,
    recipientExpiresAt: lifecycle.recipientExpiresAt,
    deletedAt: lifecycle.deletedAt,
    deleteReason: lifecycle.deleteReason,
    downloadTokenHash: lifecycle.downloadTokenHash,
    downloadCount: lifecycle.downloadCount,
    lastDownloadedAt: lifecycle.lastDownloadedAt,
    declaredContentHash: lifecycle.declaredContentHash,
    storageVersion: lifecycle.storageVersion,
    storageEtag: lifecycle.storageEtag,
    finalizedAt: lifecycle.finalizedAt,
    createdAt: lifecycle.createdAt,
    updatedAt: lifecycle.updatedAt,
  };
}

export function resolveOutboundRevisionAttachmentDownloadAvailable(input: {
  attachment: MailOutboundRevisionAttachment;
  storedFile: Pick<MailStoredFile, "securityScanStatus"> | null | undefined;
  lifecycle?: MailLargeAttachmentLifecycle | null;
  trustNowIso?: string;
}): boolean {
  if (input.attachment.deliveryMode === "direct_attachment") {
    return input.storedFile?.securityScanStatus === "clean";
  }
  if (input.attachment.deliveryMode === "large_attachment") {
    return evaluateLargeAttachmentReviewerDownloadEligibility({
      lifecycle: mapLifecycleForReviewerDownload(input.lifecycle),
      sizeBytes: input.attachment.sizeBytes,
      trustNowIso: input.trustNowIso ?? new Date().toISOString(),
    }).ok;
  }
  return false;
}

export function toSafeOutboundRevisionRecipientView(
  recipient: MailOutboundRevisionRecipient,
): SafeOutboundRevisionRecipientView {
  return {
    recipientType: recipient.recipientType,
    address: recipient.address,
    displayName: recipient.displayName,
    sortOrder: recipient.sortOrder,
  };
}

export function toSafeOutboundRevisionView(
  revision: MailOutboundRevision,
): SafeOutboundRevisionView {
  return {
    id: revision.id,
    revisionChainId: revision.revisionChainId,
    revisionNumber: revision.revisionNumber,
    parentRevisionId: revision.parentRevisionId,
    sourceDraftId: revision.sourceDraftId,
    revisionKind: revision.revisionKind,
    mailboxId: revision.mailboxId,
    senderIdentityId: revision.senderIdentityId,
    fromAddress: revision.fromAddress,
    fromDisplayName: revision.fromDisplayName,
    subject: revision.subject,
    bodyText: revision.bodyText,
    bodyHtmlSanitized: revision.bodyHtmlSanitized,
    sensitivity: revision.sensitivity,
    composeMode: revision.composeMode,
    signatureSnapshotId: revision.signatureSnapshotId,
    contentHash: revision.contentHash,
    hashVersion: revision.hashVersion,
    createdAt: revision.createdAt,
    createdByUserId: revision.createdByUserId,
  };
}

export function toSafeOutboundRevisionDetailView(
  revision: MailOutboundRevision,
  recipients: SafeOutboundRevisionRecipientView[],
  attachments: SafeOutboundRevisionAttachmentView[],
): SafeOutboundRevisionDetailView {
  return {
    ...toSafeOutboundRevisionView(revision),
    recipients,
    attachments,
  };
}
