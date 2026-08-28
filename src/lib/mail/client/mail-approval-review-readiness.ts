import type { ApprovalDetailView } from "@/lib/mail/client/mail-approval-workspace-context";
import type { OutboundRevisionAttachmentApiItem } from "@/lib/mail/client/approval-workflow-management";

export type ApprovalAttachmentsLoadState =
  | "idle"
  | "loading"
  | "loaded"
  | "error";

export const APPROVAL_ATTACHMENTS_METADATA_ERROR_KEY =
  "mail.approval.attachmentsMetadataError";

export function isValidRevisionAttachmentItem(
  item: unknown,
): item is OutboundRevisionAttachmentApiItem {
  if (!item || typeof item !== "object") return false;
  const attachment = item as Record<string, unknown>;
  return (
    typeof attachment.id === "string" &&
    attachment.id.length > 0 &&
    typeof attachment.displayFilename === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.sizeBytes === "number" &&
    Number.isFinite(attachment.sizeBytes) &&
    (attachment.deliveryMode === "direct_attachment" ||
      attachment.deliveryMode === "secure_file") &&
    typeof attachment.sortOrder === "number" &&
    Number.isFinite(attachment.sortOrder) &&
    typeof attachment.downloadAvailable === "boolean"
  );
}

export function isValidRevisionAttachmentsArray(
  attachments: unknown,
): attachments is OutboundRevisionAttachmentApiItem[] {
  return Array.isArray(attachments) && attachments.every(isValidRevisionAttachmentItem);
}

export function resolveApprovalAttachmentsState(
  revision: ApprovalDetailView["revision"] | null | undefined,
): {
  state: ApprovalAttachmentsLoadState;
  errorKey: string | null;
} {
  if (!revision) {
    return { state: "idle", errorKey: null };
  }
  if (!isValidRevisionAttachmentsArray(revision.attachments)) {
    return {
      state: "error",
      errorKey: APPROVAL_ATTACHMENTS_METADATA_ERROR_KEY,
    };
  }
  return { state: "loaded", errorKey: null };
}

export function areRevisionAttachmentsBlockingApproval(
  attachments: OutboundRevisionAttachmentApiItem[],
): boolean {
  if (attachments.length === 0) {
    return false;
  }
  return attachments.some((attachment) => attachment.downloadAvailable !== true);
}

export function isAttachmentBlockingApprovalReview(input: {
  detail: ApprovalDetailView | null;
  attachmentsLoadState: ApprovalAttachmentsLoadState;
  attachmentsLoadError: string | null;
}): boolean {
  if (input.attachmentsLoadError) {
    return true;
  }
  if (input.attachmentsLoadState === "error") {
    return true;
  }
  const attachments = input.detail?.revision.attachments;
  if (!attachments) {
    return false;
  }
  return areRevisionAttachmentsBlockingApproval(attachments);
}

export function isApprovalDetailReadyForReview(input: {
  detail: ApprovalDetailView | null;
  attachmentsLoadState: ApprovalAttachmentsLoadState;
  attachmentsLoadError: string | null;
}): boolean {
  if (
    input.attachmentsLoadState === "idle" ||
    input.attachmentsLoadState === "loading"
  ) {
    return false;
  }
  if (input.attachmentsLoadError) {
    return false;
  }
  if (input.attachmentsLoadState === "error") {
    return false;
  }

  const detail = input.detail;
  if (!detail) return false;
  if (!isValidRevisionAttachmentsArray(detail.revision.attachments)) {
    return false;
  }
  if (areRevisionAttachmentsBlockingApproval(detail.revision.attachments)) {
    return false;
  }
  if (!detail.revision.fromAddress?.trim()) return false;
  if (!detail.revision.subject?.trim()) return false;
  if (!detail.revision.recipients.some((r) => r.recipientType === "to")) {
    return false;
  }
  const body =
    detail.editableBodyHtml.trim() ||
    detail.revision.bodyText.trim() ||
    detail.revision.bodyHtmlSanitized?.trim();
  if (!body) return false;
  if (!detail.requesterLabel.trim()) return false;
  if (detail.approval.status !== "pending") return false;
  return true;
}

export function buildOutboundRevisionAttachmentDownloadHref(
  revisionId: string,
  attachmentId: string,
): string {
  return `/api/mail/outbound-revisions/${encodeURIComponent(revisionId)}/attachments/${encodeURIComponent(attachmentId)}/download`;
}

export function formatAttachmentMimeLabel(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === "application/pdf") return "PDF";
  if (normalized === "image/jpeg") return "JPEG";
  if (normalized === "image/png") return "PNG";
  if (normalized === "text/plain") return "TXT";
  const subtype = normalized.split("/")[1];
  return subtype ? subtype.toUpperCase() : mimeType;
}
