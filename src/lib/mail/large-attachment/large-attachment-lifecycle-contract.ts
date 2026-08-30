import type { MailLargeAttachmentLifecycleStatus } from "../../../../drizzle/schema/mail-large-attachment-lifecycle";

export type LargeAttachmentRemoveSemantics = {
  action: "delete_object_and_mark_cleanup";
  reason: "manual_remove";
};

export type LargeAttachmentDiscardDraftSemantics = {
  action: "delete_temporary_objects";
  scope: "draft_large_attachments_in_temporary_status";
};

export const LARGE_ATTACHMENT_REMOVE_SEMANTICS: LargeAttachmentRemoveSemantics = {
  action: "delete_object_and_mark_cleanup",
  reason: "manual_remove",
};

export const LARGE_ATTACHMENT_DISCARD_DRAFT_SEMANTICS: LargeAttachmentDiscardDraftSemantics =
  {
    action: "delete_temporary_objects",
    scope: "draft_large_attachments_in_temporary_status",
  };

/** Close/autosave intentionally retain temporary large attachments until expiry or discard. */
export const LARGE_ATTACHMENT_CLOSE_COMPOSER_RETENTION = "keep" as const;
export const LARGE_ATTACHMENT_AUTOSAVE_RETENTION = "keep" as const;

export function largeAttachmentStatusesEligibleForDraftDiscardCleanup(): MailLargeAttachmentLifecycleStatus[] {
  return ["temporary"];
}

export function largeAttachmentPlaceholderMessageKey(status: "expired"): string {
  if (status === "expired") {
    return "mail.compose.largeAttachment.expiredPlaceholder";
  }
  return "mail.compose.largeAttachment.expiredPlaceholder";
}

export function largeAttachmentApprovalExpiredMessageKey(): string {
  return "mail.compose.largeAttachment.approvalExpiredPlaceholder";
}
