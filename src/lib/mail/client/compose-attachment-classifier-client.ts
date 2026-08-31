import {
  classifyComposeAttachmentDeliveryMode,
  type ComposeAttachmentClassifierRejectCode,
} from "@/lib/mail/large-attachment/large-attachment-classifier";
import type { MailDeliveryMode } from "../../../../drizzle/schema/mail-draft-attachments";
import {
  formatComposeAttachmentLimitLabel,
} from "@/lib/mail/compose-attachment-policy";
import {
  LARGE_ATTACHMENT_MAX_AGGREGATE_BYTES,
  LARGE_ATTACHMENT_MAX_FILE_BYTES,
  TOTAL_COMPOSE_ATTACHMENT_MAX_COUNT,
} from "@/lib/mail/large-attachment/large-attachment-policy";

export type UnifiedComposeAttachmentIssueCode =
  | ComposeAttachmentClassifierRejectCode
  | "SHOULD_USE_DIRECT_ATTACHMENT";

export type UnifiedComposeAttachmentIssue = {
  code: UnifiedComposeAttachmentIssueCode;
  message: string;
  deliveryMode?: "direct_attachment" | "large_attachment";
};

export type ComposeAttachmentForClassification = {
  sizeBytes: number;
  deliveryMode: MailDeliveryMode;
  uploadStatus?: string;
};

function toMailDeliveryMode(
  kind: "attachment" | "secure_file" | "large_attachment" | undefined,
): MailDeliveryMode {
  if (kind === "large_attachment") {
    return "large_attachment";
  }
  if (kind === "secure_file") {
    return "secure_file";
  }
  return "direct_attachment";
}

export function classifyLocalComposeAttachment(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  existing: ComposeAttachmentForClassification[];
}): UnifiedComposeAttachmentIssue | null {
  const active = input.existing.filter(
    (attachment) =>
      !attachment.uploadStatus ||
      attachment.uploadStatus === "uploaded" ||
      attachment.uploadStatus === "queued" ||
      attachment.uploadStatus === "preparing" ||
      attachment.uploadStatus === "hashing" ||
      attachment.uploadStatus === "uploading" ||
      attachment.uploadStatus === "finalizing",
  );

  const existingAttachments = active.map((attachment) => ({
    sizeBytes: attachment.sizeBytes,
    deliveryMode: attachment.deliveryMode,
  }));

  const result = classifyComposeAttachmentDeliveryMode({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    existingAttachments,
  });

  if (!result.ok) {
    return {
      code: result.code,
      message: unifiedComposeAttachmentMessage(result.code),
    };
  }

  return null;
}

export function resolveComposeAttachmentRoute(
  input: Parameters<typeof classifyLocalComposeAttachment>[0],
): "direct" | "large" | UnifiedComposeAttachmentIssue {
  const issue = classifyLocalComposeAttachment(input);
  if (issue) {
    return issue;
  }
  const active = input.existing.filter(
    (attachment) =>
      !attachment.uploadStatus ||
      attachment.uploadStatus === "uploaded" ||
      attachment.uploadStatus === "queued" ||
      attachment.uploadStatus === "preparing" ||
      attachment.uploadStatus === "hashing" ||
      attachment.uploadStatus === "uploading" ||
      attachment.uploadStatus === "finalizing",
  );
  const result = classifyComposeAttachmentDeliveryMode({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    existingAttachments: active.map((attachment) => ({
      sizeBytes: attachment.sizeBytes,
      deliveryMode: attachment.deliveryMode,
    })),
  });
  if (!result.ok) {
    return {
      code: result.code,
      message: unifiedComposeAttachmentMessage(result.code),
    };
  }
  return result.deliveryMode === "large_attachment" ? "large" : "direct";
}

export function unifiedComposeAttachmentMessage(
  code: UnifiedComposeAttachmentIssueCode,
): string {
  switch (code) {
    case "FILE_TOO_LARGE":
      return `Single large attachment must be ${formatComposeAttachmentLimitLabel(LARGE_ATTACHMENT_MAX_FILE_BYTES)} or smaller`;
    case "LARGE_AGGREGATE_EXCEEDED":
      return `Total large attachments must be ${formatComposeAttachmentLimitLabel(LARGE_ATTACHMENT_MAX_AGGREGATE_BYTES)} or smaller`;
    case "TOO_MANY_ATTACHMENTS":
      return `You can attach up to ${TOTAL_COMPOSE_ATTACHMENT_MAX_COUNT} files`;
    case "UNSUPPORTED_FILE_TYPE":
      return "This file type is not supported";
    case "EMPTY_FILE":
      return "Cannot attach an empty file";
    case "FILENAME_REQUIRED":
      return "Attachment filename is required";
    case "SHOULD_USE_DIRECT_ATTACHMENT":
      return "File fits direct attachment budget";
    default:
      return "Attachment rejected";
  }
}

export function unifiedComposeAttachmentI18nKey(
  code: UnifiedComposeAttachmentIssueCode,
): string {
  switch (code) {
    case "FILE_TOO_LARGE":
      return "mail.compose.largeAttachment.fileTooLarge";
    case "LARGE_AGGREGATE_EXCEEDED":
      return "mail.compose.largeAttachment.aggregateExceeded";
    case "TOO_MANY_ATTACHMENTS":
      return "mail.compose.largeAttachment.tooMany";
    case "UNSUPPORTED_FILE_TYPE":
      return "mail.compose.attachment.unsupportedType";
    case "EMPTY_FILE":
      return "mail.compose.attachment.emptyFile";
    case "FILENAME_REQUIRED":
      return "mail.compose.attachment.filenameRequired";
    default:
      return "mail.compose.largeAttachment.uploadFailed";
  }
}

export function mapUploadStateToDeliveryMode(input: {
  kind: "attachment" | "secure_file" | "large_attachment";
  uploadStatus: string;
}): MailDeliveryMode {
  return toMailDeliveryMode(input.kind);
}
