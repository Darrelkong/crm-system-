/** Cloudflare ordinary external-recipient total message limit (body + headers + MIME + attachments). */
export const CLOUDFLARE_EMAIL_GENERAL_MESSAGE_LIMIT_BYTES =
  5 * 1024 * 1024;

/** V1 ordinary-email raw attachment aggregate cap before MIME/base64 expansion. */
export const ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES =
  3 * 1024 * 1024;

export const OUTBOUND_PROVIDER_SIZE_ERROR_CODES = {
  messageTooLargeForEmailProvider: "MESSAGE_TOO_LARGE_FOR_EMAIL_PROVIDER",
  ordinaryAttachmentAggregateExceeded:
    "ORDINARY_EMAIL_ATTACHMENT_AGGREGATE_EXCEEDED",
} as const;

/** Conservative MIME/base64 expansion factor for attachment encoded size estimates. */
export const OUTBOUND_ATTACHMENT_BASE64_EXPANSION_NUMERATOR = 4;

export const OUTBOUND_ATTACHMENT_BASE64_EXPANSION_DENOMINATOR = 3;

/** Fixed reserve for multipart boundaries, headers, and encoding overhead. */
export const OUTBOUND_PROVIDER_MESSAGE_SAFETY_RESERVE_BYTES = 32 * 1024;
