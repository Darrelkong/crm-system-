import type { MailMessageAttachment } from "../../../drizzle/schema/mail-message-attachments";
import type { MailSecurityScanStatus } from "../../../drizzle/schema/mail-stored-files";
import { resolveMailAttachmentDownloadable } from "@/lib/mail/mail-attachment-preview";

/**
 * Policy-only download availability for Production Message Detail.
 * Does not probe R2 object existence.
 */
export function isMailAttachmentDownloadAvailable(input: {
  deliveryMode: MailMessageAttachment["deliveryMode"];
  securityScanStatus: MailSecurityScanStatus;
}): boolean {
  return resolveMailAttachmentDownloadable(input);
}
