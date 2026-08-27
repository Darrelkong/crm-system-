import type { ApprovalDetailView } from "@/lib/mail/client/mail-approval-workspace-context";

export type ApprovalAttachmentsLoadState =
  | "idle"
  | "loading"
  | "loaded"
  | "error";

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

  const detail = input.detail;
  if (!detail) return false;
  if (!Array.isArray(detail.revision.attachments)) {
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
