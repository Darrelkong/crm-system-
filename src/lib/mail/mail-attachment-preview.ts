
export type MailAttachmentPreviewType = "image" | "pdf";

export const MAIL_ATTACHMENT_PREVIEW_MIME_TYPES = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
} as const;

function normalizedExtension(filename: string): string {
  const basename = filename.trim().split(/[\\/]/).pop() ?? "";
  const dot = basename.lastIndexOf(".");
  return dot >= 0 ? basename.slice(dot + 1).toLowerCase() : "";
}

function normalizedMimeType(mimeType: string): string {
  return mimeType.trim().toLowerCase().split(";", 1)[0]!.trim();
}

export function resolveMailAttachmentPreviewType(input: {
  mimeType: string;
  filename: string;
}): MailAttachmentPreviewType | null {
  const mimeType = normalizedMimeType(input.mimeType);
  if (mimeType === MAIL_ATTACHMENT_PREVIEW_MIME_TYPES.pdf) {
    return "pdf";
  }
  if (
    mimeType === MAIL_ATTACHMENT_PREVIEW_MIME_TYPES.jpeg ||
    mimeType === MAIL_ATTACHMENT_PREVIEW_MIME_TYPES.png
  ) {
    return "image";
  }

  // Inbound providers may persist octet-stream when the MIME header is absent.
  // This is only a UI capability hint; content endpoint validation still checks bytes.
  if (mimeType === "application/octet-stream") {
    const extension = normalizedExtension(input.filename);
    if (extension === "pdf") return "pdf";
    if (extension === "jpg" || extension === "jpeg" || extension === "png") {
      return "image";
    }
  }
  return null;
}

export function resolveMailAttachmentDownloadable(input: {
  deliveryMode: string;
  securityScanStatus: string;
}): boolean {
  return (
    input.deliveryMode === "direct_attachment" &&
    input.securityScanStatus !== "blocked" &&
    input.securityScanStatus !== "scan_failed"
  );
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

export function resolveMailAttachmentPreviewContentType(input: {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}): { previewType: MailAttachmentPreviewType; contentType: string } | null {
  const candidate = resolveMailAttachmentPreviewType(input);
  if (!candidate) {
    return null;
  }

  if (
    candidate === "pdf" &&
    startsWithBytes(
      input.bytes,
      Array.from(new TextEncoder().encode("%PDF-")),
    )
  ) {
    return {
      previewType: "pdf",
      contentType: MAIL_ATTACHMENT_PREVIEW_MIME_TYPES.pdf,
    };
  }

  if (
    candidate === "image" &&
    startsWithBytes(input.bytes, [0xff, 0xd8, 0xff])
  ) {
    return {
      previewType: "image",
      contentType: MAIL_ATTACHMENT_PREVIEW_MIME_TYPES.jpeg,
    };
  }

  if (
    candidate === "image" &&
    startsWithBytes(input.bytes, [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
    ])
  ) {
    return {
      previewType: "image",
      contentType: MAIL_ATTACHMENT_PREVIEW_MIME_TYPES.png,
    };
  }

  return null;
}
