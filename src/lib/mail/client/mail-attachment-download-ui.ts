import type { MailReadFolder } from "@/lib/mail/client/mail-read-types";
import { validateFolder } from "@/lib/mail/client/mail-read-api-validation";
import type { MailDetailAttachmentPresentation } from "@/lib/mail/client/mail-workspace-ui-adapters";

export function buildProductionAttachmentDownloadHref(
  attachmentId: string,
  folder: MailReadFolder,
): string {
  const normalizedFolder = validateFolder(folder);
  return `/api/mail/attachments/${encodeURIComponent(attachmentId)}/content?folder=${encodeURIComponent(normalizedFolder)}&disposition=attachment`;
}

export function buildProductionAttachmentPreviewHref(
  attachmentId: string,
  folder: MailReadFolder,
): string {
  const normalizedFolder = validateFolder(folder);
  return `/api/mail/attachments/${encodeURIComponent(attachmentId)}/content?folder=${encodeURIComponent(normalizedFolder)}&disposition=inline`;
}

export type ProductionAttachmentRowPresentation = {
  downloadAvailable: boolean;
  downloadable: boolean;
  downloadHref: string | null;
  previewable: boolean;
  previewType: "image" | "pdf" | null;
  previewHref: string | null;
  filename: string;
  sizeLabel: string;
  showSecureFileLabel: boolean;
};

export function buildProductionAttachmentRowPresentation(input: {
  attachment: MailDetailAttachmentPresentation;
  folder: MailReadFolder;
}): ProductionAttachmentRowPresentation {
  const downloadable =
    input.attachment.downloadable ?? input.attachment.downloadAvailable;
  return {
    downloadAvailable: downloadable,
    downloadable,
    downloadHref: downloadable
      ? buildProductionAttachmentDownloadHref(input.attachment.id, input.folder)
      : null,
    previewable: input.attachment.previewable === true,
    previewType: input.attachment.previewType ?? null,
    previewHref:
      input.attachment.previewable === true
        ? buildProductionAttachmentPreviewHref(input.attachment.id, input.folder)
        : null,
    filename: input.attachment.filename,
    sizeLabel: input.attachment.sizeLabel,
    showSecureFileLabel: input.attachment.deliveryMode === "secure_file",
  };
}
