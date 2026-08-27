import {
  CLOUDFLARE_EMAIL_GENERAL_MESSAGE_LIMIT_BYTES,
  ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES,
  OUTBOUND_ATTACHMENT_BASE64_EXPANSION_DENOMINATOR,
  OUTBOUND_ATTACHMENT_BASE64_EXPANSION_NUMERATOR,
  OUTBOUND_PROVIDER_MESSAGE_SAFETY_RESERVE_BYTES,
  OUTBOUND_PROVIDER_SIZE_ERROR_CODES,
} from "@/lib/mail/outbound-provider-size-constants";

export type OutboundProviderSizeEstimateInput = {
  subject: string;
  text?: string | null;
  html?: string | null;
  signatureText?: string | null;
  signatureHtml?: string | null;
  toCount: number;
  ccCount: number;
  bccCount: number;
  headerEntries?: Array<{ name: string; value: string }>;
  attachments: Array<{ sizeBytes: number; filename: string; mimeType: string }>;
};

export type OutboundProviderSizePreflightResult =
  | { ok: true; estimatedTotalBytes: number }
  | {
      ok: false;
      code: string;
      message: string;
      estimatedTotalBytes: number;
    };

function utf8ByteLength(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  return new TextEncoder().encode(value).length;
}

function estimateHeaderBytes(
  subject: string,
  recipientCount: number,
  headerEntries: Array<{ name: string; value: string }>,
): number {
  let total = utf8ByteLength(subject) + 256;
  total += recipientCount * 96;
  for (const entry of headerEntries) {
    total += utf8ByteLength(entry.name) + utf8ByteLength(entry.value) + 4;
  }
  return total;
}

function estimateEncodedAttachmentBytes(sizeBytes: number): number {
  return Math.ceil(
    (sizeBytes * OUTBOUND_ATTACHMENT_BASE64_EXPANSION_NUMERATOR) /
      OUTBOUND_ATTACHMENT_BASE64_EXPANSION_DENOMINATOR,
  );
}

export function sumDirectAttachmentRawBytes(
  attachments: Array<{ sizeBytes: number; deliveryMode?: string }>,
): number {
  return attachments
    .filter(
      (attachment) =>
        !attachment.deliveryMode ||
        attachment.deliveryMode === "direct_attachment",
    )
    .reduce((sum, attachment) => sum + Math.max(0, attachment.sizeBytes), 0);
}

export function assertOrdinaryEmailAttachmentAggregateWithinLimit(input: {
  attachments: Array<{ sizeBytes: number; deliveryMode?: string }>;
}): void {
  const aggregate = sumDirectAttachmentRawBytes(input.attachments);
  if (aggregate > ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES) {
    throw new Error(
      OUTBOUND_PROVIDER_SIZE_ERROR_CODES.ordinaryAttachmentAggregateExceeded,
    );
  }
}

export function estimateOutboundProviderMessageBytes(
  input: OutboundProviderSizeEstimateInput,
): number {
  const bodyBytes =
    utf8ByteLength(input.text) +
    utf8ByteLength(input.html) +
    utf8ByteLength(input.signatureText) +
    utf8ByteLength(input.signatureHtml);

  const headerBytes = estimateHeaderBytes(
    input.subject,
    input.toCount + input.ccCount + input.bccCount,
    input.headerEntries ?? [],
  );

  const attachmentBytes = input.attachments.reduce(
    (sum, attachment) => sum + estimateEncodedAttachmentBytes(attachment.sizeBytes),
    0,
  );

  const mimeOverhead =
    input.attachments.length * 512 +
    OUTBOUND_PROVIDER_MESSAGE_SAFETY_RESERVE_BYTES;

  return bodyBytes + headerBytes + attachmentBytes + mimeOverhead;
}

export function runOutboundProviderSizePreflight(
  input: OutboundProviderSizeEstimateInput,
): OutboundProviderSizePreflightResult {
  try {
    assertOrdinaryEmailAttachmentAggregateWithinLimit({
      attachments: input.attachments,
    });
  } catch {
    const estimatedTotalBytes = estimateOutboundProviderMessageBytes(input);
    return {
      ok: false,
      code: OUTBOUND_PROVIDER_SIZE_ERROR_CODES.ordinaryAttachmentAggregateExceeded,
      message:
        "Ordinary email direct attachment aggregate exceeds provider-safe limit",
      estimatedTotalBytes,
    };
  }

  const estimatedTotalBytes = estimateOutboundProviderMessageBytes(input);
  if (estimatedTotalBytes >= CLOUDFLARE_EMAIL_GENERAL_MESSAGE_LIMIT_BYTES) {
    return {
      ok: false,
      code: OUTBOUND_PROVIDER_SIZE_ERROR_CODES.messageTooLargeForEmailProvider,
      message: "Estimated outbound message exceeds Cloudflare 5 MiB provider limit",
      estimatedTotalBytes,
    };
  }

  return { ok: true, estimatedTotalBytes };
}
