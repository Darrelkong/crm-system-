import { ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES } from "@/lib/mail/outbound-provider-size-constants";

/** Ordinary-email compose attachment limits — provider-safe for Cloudflare 5 MiB messages. */
export const MAIL_COMPOSE_ATTACHMENT_LIMITS = {
  /** Single ordinary attachment must fit within the aggregate provider-safe cap. */
  maxSingleFileBytes: ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES,
  maxTotalBytes: ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES,
  maxAttachmentCount: 10,
} as const;

export type ComposeAttachmentPolicyIssueCode =
  | "FILE_TOO_LARGE"
  | "TOTAL_SIZE_EXCEEDED"
  | "TOO_MANY_ATTACHMENTS"
  | "UNSUPPORTED_FILE_TYPE"
  | "EMPTY_FILE"
  | "FILENAME_REQUIRED";

export type ComposeAttachmentPolicyIssue = {
  code: ComposeAttachmentPolicyIssueCode;
  message: string;
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
]);

const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".scr",
  ".ps1",
  ".sh",
  ".js",
  ".vbs",
  ".jar",
  ".app",
  ".dmg",
]);

export function normalizeAttachmentFilename(filename: string): string {
  const trimmed = filename.trim().normalize("NFC");
  const base = trimmed.split(/[/\\]/).pop() ?? trimmed;
  return base.slice(0, 255);
}

export function isBlockedAttachmentFilename(filename: string): boolean {
  const normalized = normalizeAttachmentFilename(filename).toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex === -1) {
    return false;
  }
  const extension = normalized.slice(dotIndex);
  return BLOCKED_EXTENSIONS.has(extension);
}

export function isBlockedAttachmentMimeType(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return BLOCKED_MIME_TYPES.has(normalized);
}

export function validateComposeAttachmentCandidate(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  existingAttachmentCount: number;
  existingTotalBytes: number;
}): ComposeAttachmentPolicyIssue | null {
  const filename = normalizeAttachmentFilename(input.filename);
  if (!filename) {
    return {
      code: "FILENAME_REQUIRED",
      message: "Attachment filename is required",
    };
  }
  if (input.sizeBytes <= 0) {
    return {
      code: "EMPTY_FILE",
      message: "Attachment file is empty",
    };
  }
  if (input.sizeBytes > MAIL_COMPOSE_ATTACHMENT_LIMITS.maxSingleFileBytes) {
    return {
      code: "FILE_TOO_LARGE",
      message: "Attachment exceeds maximum single-file size",
    };
  }
  if (
    input.existingAttachmentCount >=
    MAIL_COMPOSE_ATTACHMENT_LIMITS.maxAttachmentCount
  ) {
    return {
      code: "TOO_MANY_ATTACHMENTS",
      message: "Maximum attachment count reached",
    };
  }
  if (
    input.existingTotalBytes + input.sizeBytes >
    MAIL_COMPOSE_ATTACHMENT_LIMITS.maxTotalBytes
  ) {
    return {
      code: "TOTAL_SIZE_EXCEEDED",
      message: "Total attachment size would exceed the limit",
    };
  }
  if (
    isBlockedAttachmentFilename(filename) ||
    isBlockedAttachmentMimeType(input.mimeType)
  ) {
    return {
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Unsupported attachment file type",
    };
  }
  return null;
}
