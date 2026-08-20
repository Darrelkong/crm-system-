import type { MailDeliveryEventType } from "../../../drizzle/schema/mail-delivery-events";
import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";

export type DeliveryIngestionDedupeKeyInput = {
  provider: string;
  providerEventId: string;
  recipientAddress: string;
  deliveryEventType: MailDeliveryEventType;
};

/**
 * 0061 / 0058 semantic idempotency boundary for delivery_event ingestion.
 * Copied to mail_delivery_events.event_dedupe_key on materialization.
 */
export function buildDeliveryIngestionDedupeKey(
  input: DeliveryIngestionDedupeKeyInput,
): string {
  const provider = input.provider.trim();
  if (!provider) {
    throw new Error("Provider is required for delivery ingestion dedupe key");
  }

  const providerEventId = input.providerEventId.trim();
  if (!providerEventId) {
    throw new Error("Provider event id is required for delivery ingestion dedupe key");
  }

  const normalizedRecipient = normalizeMailEmailAddress(input.recipientAddress);

  return `delivery:v1:${provider}:${providerEventId}:${normalizedRecipient}:${input.deliveryEventType}`;
}
