import type { MailReadFolder } from "@/lib/mail/client/mail-read-types";
import { validateFolder } from "@/lib/mail/client/mail-read-api-validation";
import type { MailDetailAttachmentPresentation } from "@/lib/mail/client/mail-workspace-ui-adapters";

export function buildProductionAttachmentDownloadHref(
  attachmentId: string,
  folder: MailReadFolder,
): string {
  const normalizedFolder = validateFolder(folder);
  return `/api/mail/attachments/${encodeURIComponent(attachmentId)}/download?folder=${encodeURIComponent(normalizedFolder)}`;
}

export type ProductionAttachmentRowPresentation = {
  downloadAvailable: boolean;
  downloadHref: string | null;
  filename: string;
  sizeLabel: string;
  showSecureFileLabel: boolean;
};

export function buildProductionAttachmentRowPresentation(input: {
  attachment: MailDetailAttachmentPresentation;
  folder: MailReadFolder;
}): ProductionAttachmentRowPresentation {
  return {
    downloadAvailable: input.attachment.downloadAvailable,
    downloadHref: input.attachment.downloadAvailable
      ? buildProductionAttachmentDownloadHref(input.attachment.id, input.folder)
      : null,
    filename: input.attachment.filename,
    sizeLabel: input.attachment.sizeLabel,
    showSecureFileLabel: input.attachment.deliveryMode === "secure_file",
  };
}
