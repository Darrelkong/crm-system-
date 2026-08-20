import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";

export type InboundIngestionDedupeKeyInput = {
  provider: string;
  providerEventId?: string | null;
  providerMessageId?: string | null;
  envelopeRecipientAddress: string;
};

/**
 * 0061 semantic idempotency boundary for inbound_message events.
 * Distinguishes actual inbound envelope recipient — not a random UUID.
 */
export function buildInboundIngestionDedupeKey(
  input: InboundIngestionDedupeKeyInput,
): string {
  const provider = input.provider.trim();
  if (!provider) {
    throw new Error("Provider is required for inbound ingestion dedupe key");
  }

  const normalizedRecipient = normalizeMailEmailAddress(
    input.envelopeRecipientAddress,
  );

  const providerIdentity =
    input.providerEventId?.trim() ||
    input.providerMessageId?.trim() ||
    null;

  if (!providerIdentity) {
    throw new Error(
      "Provider event id or provider message id is required for inbound ingestion dedupe key",
    );
  }

  return `inbound:v1:${provider}:${providerIdentity}:${normalizedRecipient}`;
}
