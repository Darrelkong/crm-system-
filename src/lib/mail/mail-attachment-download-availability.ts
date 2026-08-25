import type { MailMessageAttachment } from "../../../drizzle/schema/mail-message-attachments";
import type { MailSecurityScanStatus } from "../../../drizzle/schema/mail-stored-files";

/**
 * Policy-only download availability for Production Message Detail.
 * Does not probe R2 object existence.
 */
export function isMailAttachmentDownloadAvailable(input: {
  deliveryMode: MailMessageAttachment["deliveryMode"];
  securityScanStatus: MailSecurityScanStatus;
}): boolean {
  return (
    input.deliveryMode === "direct_attachment" &&
    input.securityScanStatus === "clean"
  );
}
