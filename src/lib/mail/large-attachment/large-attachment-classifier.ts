import type { MailDeliveryMode } from "../../../../drizzle/schema/mail-draft-attachments";
import {
  isBlockedAttachmentFilename,
  isBlockedAttachmentMimeType,
  normalizeAttachmentFilename,
} from "@/lib/mail/compose-attachment-policy";
import {
  DIRECT_COMPOSE_ATTACHMENT_AGGREGATE_BYTES,
  LARGE_ATTACHMENT_MAX_AGGREGATE_BYTES,
  LARGE_ATTACHMENT_MAX_FILE_BYTES,
  TOTAL_COMPOSE_ATTACHMENT_MAX_COUNT,
} from "@/lib/mail/large-attachment/large-attachment-policy";

export type ComposeAttachmentClassifierDeliveryMode = Extract<
  MailDeliveryMode,
  "direct_attachment" | "large_attachment"
>;

export type ComposeAttachmentClassifierRejectCode =
  | "FILE_TOO_LARGE"
  | "LARGE_AGGREGATE_EXCEEDED"
  | "TOO_MANY_ATTACHMENTS"
  | "UNSUPPORTED_FILE_TYPE"
  | "EMPTY_FILE"
  | "FILENAME_REQUIRED";

export type ComposeAttachmentClassifierResult =
  | { ok: true; deliveryMode: ComposeAttachmentClassifierDeliveryMode }
  | { ok: false; code: ComposeAttachmentClassifierRejectCode };

export type ExistingComposeAttachmentForClassification = {
  sizeBytes: number;
  deliveryMode: MailDeliveryMode;
};

function sumDirectAttachmentBytes(
  attachments: ExistingComposeAttachmentForClassification[],
): number {
  return attachments
    .filter((attachment) => attachment.deliveryMode === "direct_attachment")
    .reduce((sum, attachment) => sum + Math.max(0, attachment.sizeBytes), 0);
}

function sumLargeAttachmentBytes(
  attachments: ExistingComposeAttachmentForClassification[],
): number {
  return attachments
    .filter((attachment) => attachment.deliveryMode === "large_attachment")
    .reduce((sum, attachment) => sum + Math.max(0, attachment.sizeBytes), 0);
}

/**
 * Pure deterministic classifier for a new compose attachment candidate.
 * Blocked file types reject outright — never auto-convert to large_attachment.
 */
export function classifyComposeAttachmentDeliveryMode(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  existingAttachments: ExistingComposeAttachmentForClassification[];
}): ComposeAttachmentClassifierResult {
  const filename = normalizeAttachmentFilename(input.filename);
  if (!filename) {
    return { ok: false, code: "FILENAME_REQUIRED" };
  }
  if (input.sizeBytes <= 0) {
    return { ok: false, code: "EMPTY_FILE" };
  }
  if (
    isBlockedAttachmentFilename(filename) ||
    isBlockedAttachmentMimeType(input.mimeType)
  ) {
    return { ok: false, code: "UNSUPPORTED_FILE_TYPE" };
  }
  if (input.existingAttachments.length >= TOTAL_COMPOSE_ATTACHMENT_MAX_COUNT) {
    return { ok: false, code: "TOO_MANY_ATTACHMENTS" };
  }
  if (input.sizeBytes > LARGE_ATTACHMENT_MAX_FILE_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE" };
  }

  const directBytes = sumDirectAttachmentBytes(input.existingAttachments);
  const largeBytes = sumLargeAttachmentBytes(input.existingAttachments);

  const fitsDirectAggregate =
    input.sizeBytes <= DIRECT_COMPOSE_ATTACHMENT_AGGREGATE_BYTES &&
    directBytes + input.sizeBytes <= DIRECT_COMPOSE_ATTACHMENT_AGGREGATE_BYTES;

  if (fitsDirectAggregate) {
    return { ok: true, deliveryMode: "direct_attachment" };
  }

  if (largeBytes + input.sizeBytes > LARGE_ATTACHMENT_MAX_AGGREGATE_BYTES) {
    return { ok: false, code: "LARGE_AGGREGATE_EXCEEDED" };
  }

  return { ok: true, deliveryMode: "large_attachment" };
}
