import type { Database } from "@/lib/db";
import {
  CLOUDFLARE_EMAIL_ROUTING_PROVIDER,
  INBOUND_MIME_MAX_BYTES,
} from "@/lib/mail/inbound-ingress-constants";
import {
  computeInboundRawMimeFingerprint,
  formatCloudflareEmailProviderEventId,
} from "@/lib/mail/inbound-ingress-fingerprint";
import type { InboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import {
  stageInboundProviderEvent,
  type StageInboundProviderEventResult,
} from "@/lib/mail/inbound-provider-staging-service";

/** Subset of Cloudflare ForwardableEmailMessage used by the ingress adapter. */
export type CloudflareForwardableEmailMessage = {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
};

export type InboundEmailIngressErrorCode =
  | "MIME_TOO_LARGE"
  | "EMPTY_RAW_MIME"
  | "MISSING_ENVELOPE_RECIPIENT"
  | "STAGING_NOT_ACK_SAFE";

export class InboundEmailIngressError extends Error {
  readonly code: InboundEmailIngressErrorCode;

  constructor(code: InboundEmailIngressErrorCode, message: string) {
    super(message);
    this.name = "InboundEmailIngressError";
    this.code = code;
  }
}

export type ReadInboundRawMimeResult = {
  bytes: Uint8Array;
  fingerprint: string;
  providerEventId: string;
  sizeBytes: number;
};

function extractEnvelopeRecipients(message: CloudflareForwardableEmailMessage): string[] {
  const recipient = message.to?.trim();
  if (!recipient) {
    throw new InboundEmailIngressError(
      "MISSING_ENVELOPE_RECIPIENT",
      "Cloudflare envelope recipient (message.to) is required",
    );
  }
  return [recipient];
}

/**
 * Consume raw MIME exactly once, verify size, and derive deterministic provider identity.
 * Fingerprints raw bytes — does not decode MIME as UTF-8.
 */
export async function readInboundRawMimeBytes(
  message: Pick<CloudflareForwardableEmailMessage, "raw" | "rawSize">,
  maxBytes: number = INBOUND_MIME_MAX_BYTES,
): Promise<ReadInboundRawMimeResult> {
  if (message.rawSize > maxBytes) {
    throw new InboundEmailIngressError(
      "MIME_TOO_LARGE",
      `Inbound MIME exceeds ${maxBytes} byte limit`,
    );
  }

  const reader = message.raw.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value?.byteLength) {
        continue;
      }
      sizeBytes += value.byteLength;
      if (sizeBytes > maxBytes) {
        throw new InboundEmailIngressError(
          "MIME_TOO_LARGE",
          `Inbound MIME exceeds ${maxBytes} byte limit`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (sizeBytes === 0) {
    throw new InboundEmailIngressError("EMPTY_RAW_MIME", "Inbound raw MIME is empty");
  }

  const bytes = new Uint8Array(sizeBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const fingerprint = await computeInboundRawMimeFingerprint(bytes);
  const providerEventId = formatCloudflareEmailProviderEventId(fingerprint);

  return {
    bytes,
    fingerprint,
    providerEventId,
    sizeBytes,
  };
}

export function buildCloudflareEmailStagingInput(input: {
  message: CloudflareForwardableEmailMessage;
  rawMime: ReadInboundRawMimeResult;
  receivedAt?: string;
}) {
  return {
    provider: CLOUDFLARE_EMAIL_ROUTING_PROVIDER,
    providerEventId: input.rawMime.providerEventId,
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    rawPayloadBytes: input.rawMime.bytes,
    envelopeRecipients: extractEnvelopeRecipients(input.message),
  };
}

/**
 * Thin Cloudflare Email ingress adapter — durable staging only.
 * Parsing, sanitization, and materialization remain async in mail-jobs-cron.
 */
export async function stageCloudflareInboundEmail(
  db: Database,
  payloadStore: InboundRawPayloadStore,
  message: CloudflareForwardableEmailMessage,
  options?: { receivedAt?: string; maxBytes?: number },
): Promise<StageInboundProviderEventResult> {
  const rawMime = await readInboundRawMimeBytes(message, options?.maxBytes);
  const stagingInput = buildCloudflareEmailStagingInput({
    message,
    rawMime,
    receivedAt: options?.receivedAt,
  });

  const result = await stageInboundProviderEvent(db, payloadStore, stagingInput);
  if (!result.safeToAcknowledgeProvider) {
    throw new InboundEmailIngressError(
      "STAGING_NOT_ACK_SAFE",
      "Inbound provider event was not durably staged",
    );
  }
  return result;
}
