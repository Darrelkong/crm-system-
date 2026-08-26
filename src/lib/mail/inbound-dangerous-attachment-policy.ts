import { INBOUND_ATTACHMENT_MAX_BYTES } from "@/lib/mail/inbound-ingress-constants";

export type InboundDangerousAttachmentViolation = {
  filename: string;
  reason: "blocked_extension" | "blocked_mime_type" | "oversized";
};

const BLOCKED_MIME_TYPES = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-sh",
  "application/x-bat",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "application/vnd.microsoft.portable-executable",
  "application/x-msi",
  "application/java-archive",
  "application/x-java-archive",
  "text/vbscript",
  "application/x-vbs",
  "application/hta",
]);

/** V1 executable/script-oriented inbound attachment extensions (case-insensitive). */
const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".scr",
  ".js",
  ".jse",
  ".vbs",
  ".vbe",
  ".ps1",
  ".psm1",
  ".msi",
  ".jar",
  ".hta",
]);

export function normalizeInboundAttachmentFilename(filename: string): string {
  const trimmed = filename.trim().normalize("NFC");
  const base = trimmed.split(/[/\\]/).pop() ?? trimmed;
  return base.replace(/[.\s]+$/u, "").slice(0, 255);
}

export function isDangerousInboundAttachmentFilename(filename: string): boolean {
  const normalized = normalizeInboundAttachmentFilename(filename).toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex === -1) {
    return false;
  }
  const extension = normalized.slice(dotIndex);
  return BLOCKED_EXTENSIONS.has(extension);
}

export function isDangerousInboundAttachmentMimeType(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return BLOCKED_MIME_TYPES.has(normalized);
}

export function findInboundDangerousAttachmentViolation(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): InboundDangerousAttachmentViolation | null {
  const filename = normalizeInboundAttachmentFilename(input.filename);
  if (!filename) {
    return {
      filename: input.filename,
      reason: "blocked_extension",
    };
  }
  if (input.sizeBytes > INBOUND_ATTACHMENT_MAX_BYTES) {
    return {
      filename,
      reason: "oversized",
    };
  }
  if (
    isDangerousInboundAttachmentFilename(filename) ||
    isDangerousInboundAttachmentMimeType(input.mimeType)
  ) {
    return {
      filename,
      reason: isDangerousInboundAttachmentFilename(filename)
        ? "blocked_extension"
        : "blocked_mime_type",
    };
  }
  return null;
}

export function findFirstInboundDangerousAttachmentViolation(
  attachments: ReadonlyArray<{
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
  }>,
): InboundDangerousAttachmentViolation | null {
  for (const attachment of attachments) {
    const violation = findInboundDangerousAttachmentViolation({
      filename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    });
    if (violation) {
      return violation;
    }
  }
  return null;
}
