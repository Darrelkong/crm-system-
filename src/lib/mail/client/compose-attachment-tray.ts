import type { ComposeAttachmentDraft } from "@/lib/mail/client/draft-management";
import { formatAttachmentSize } from "@/lib/mail/client/draft-management";

export type ComposeAttachmentTraySummary = {
  count: number;
  totalBytes: number;
  totalSizeLabel: string;
};

export function summarizeComposeAttachments(
  attachments: Pick<ComposeAttachmentDraft, "sizeBytes">[],
): ComposeAttachmentTraySummary {
  const totalBytes = attachments.reduce(
    (sum, attachment) => sum + Math.max(0, attachment.sizeBytes ?? 0),
    0,
  );
  return {
    count: attachments.length,
    totalBytes,
    totalSizeLabel: formatAttachmentSize(totalBytes),
  };
}

export function composeAttachmentTrayRootClassName(
  variant: "embedded-mobile" | "floating-desktop",
): string {
  return variant === "embedded-mobile"
    ? "mail-compose-attachment-tray mail-compose-attachment-tray--mobile shrink-0 border-t crm-border px-3 py-2"
    : "mail-compose-attachment-tray mail-compose-attachment-tray--desktop shrink-0 border-t crm-border px-3 py-2";
}

export function composeAttachmentTrayListClassName(
  variant: "embedded-mobile" | "floating-desktop",
): string {
  return variant === "embedded-mobile"
    ? "mail-compose-attachment-tray-list mail-compose-attachment-tray-list--mobile grid grid-cols-1 gap-1.5"
    : "mail-compose-attachment-tray-list mail-compose-attachment-tray-list--desktop grid grid-cols-1 gap-1.5 sm:grid-cols-2";
}

export function composeAttachmentTraySummaryKey(): string {
  return "mail.compose.attachment.traySummary";
}

export function composeAttachmentTrayKindKey(): string {
  return "mail.compose.attachment.kindDirect";
}
