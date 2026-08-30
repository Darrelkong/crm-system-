import type { MailSecurityScanStatus } from "../../../../drizzle/schema/mail-stored-files";

/**
 * Large attachments must not inherit the direct-attachment stub that marks files "clean"
 * without scanning. V1 uses existing `unscanned` until a real scanner exists.
 */
export const LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS = "unscanned" as const satisfies MailSecurityScanStatus;

export function isLargeAttachmentSecurityScanEligible(
  status: MailSecurityScanStatus,
): boolean {
  return status === LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS;
}

export function largeAttachmentStoredFileScanStatusOnFinalize(): MailSecurityScanStatus {
  return LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS;
}
