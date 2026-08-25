import type { MailDeliveryEventType } from "../../../drizzle/schema/mail-delivery-events";

/** Provider-agnostic normalized delivery callback before staging. */
export type NormalizedProviderDeliveryEvent = {
  provider: string;
  providerEventId: string;
  providerRequestId: string | null;
  providerMessageId: string | null;
  recipientAddress: string;
  deliveryEventType: MailDeliveryEventType;
  providerOccurredAt: string | null;
  smtpStatusCode: string | null;
  smtpEnhancedStatusCode: string | null;
  diagnosticMessage: string | null;
  /** UI-only lifecycle hint when provider sends complaint/failed semantics. */
  lifecycleHint: DeliveryLifecycleHint | null;
};

export type DeliveryLifecycleHint = "complaint" | "provider_failed";

export type ProviderDeliveryEventKind =
  | "accepted"
  | "delivered"
  | "deferred"
  | "failed"
  | "bounced"
  | "complaint";

const PROVIDER_EVENT_TYPE_ALIASES: Record<string, ProviderDeliveryEventKind> = {
  accepted: "accepted",
  delivery: "delivered",
  delivered: "delivered",
  defer: "deferred",
  deferred: "deferred",
  delay: "deferred",
  failed: "failed",
  failure: "failed",
  bounce: "bounced",
  bounced: "bounced",
  hard_bounce: "bounced",
  soft_bounce: "bounced",
  complaint: "complaint",
  spamreport: "complaint",
  spam_report: "complaint",
};

export function normalizeProviderDeliveryEventType(
  rawType: string,
): ProviderDeliveryEventKind | null {
  const normalized = rawType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return PROVIDER_EVENT_TYPE_ALIASES[normalized] ?? null;
}

export function mapProviderEventKindToDeliveryEventType(
  kind: ProviderDeliveryEventKind,
): MailDeliveryEventType | null {
  switch (kind) {
    case "delivered":
      return "delivered";
    case "deferred":
      return "deferred";
    case "bounced":
    case "complaint":
    case "failed":
      return "bounced";
    case "accepted":
      return null;
    default:
      return null;
  }
}

export function deriveDeliveryLifecycleHint(
  kind: ProviderDeliveryEventKind,
): DeliveryLifecycleHint | null {
  if (kind === "complaint") {
    return "complaint";
  }
  if (kind === "failed") {
    return "provider_failed";
  }
  return null;
}

export type RawProviderDeliveryWebhookPayload = {
  eventId?: unknown;
  eventType?: unknown;
  type?: unknown;
  messageId?: unknown;
  requestId?: unknown;
  recipient?: unknown;
  email?: unknown;
  occurredAt?: unknown;
  timestamp?: unknown;
  smtpStatusCode?: unknown;
  smtpEnhancedStatusCode?: unknown;
  diagnosticMessage?: unknown;
  reason?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeProviderDeliveryWebhookPayload(input: {
  provider: string;
  payload: RawProviderDeliveryWebhookPayload;
}): NormalizedProviderDeliveryEvent {
  const providerEventId =
    readString(input.payload.eventId) ??
    readString(input.payload.requestId) ??
    readString(input.payload.messageId);
  if (!providerEventId) {
    throw new Error("Provider event id is required");
  }

  const rawType =
    readString(input.payload.eventType) ?? readString(input.payload.type);
  if (!rawType) {
    throw new Error("Provider event type is required");
  }

  const kind = normalizeProviderDeliveryEventType(rawType);
  if (!kind) {
    throw new Error(`Unsupported provider delivery event type: ${rawType}`);
  }

  const deliveryEventType = mapProviderEventKindToDeliveryEventType(kind);
  if (!deliveryEventType) {
    throw new Error(
      `Provider event type ${rawType} is transport-level only and cannot be staged as delivery`,
    );
  }

  const recipientAddress =
    readString(input.payload.recipient) ?? readString(input.payload.email);
  if (!recipientAddress) {
    throw new Error("Recipient address is required");
  }

  return {
    provider: input.provider.trim(),
    providerEventId,
    providerRequestId: readString(input.payload.requestId),
    providerMessageId: readString(input.payload.messageId),
    recipientAddress,
    deliveryEventType,
    providerOccurredAt:
      readString(input.payload.occurredAt) ??
      readString(input.payload.timestamp),
    smtpStatusCode: readString(input.payload.smtpStatusCode),
    smtpEnhancedStatusCode: readString(input.payload.smtpEnhancedStatusCode),
    diagnosticMessage:
      readString(input.payload.diagnosticMessage) ??
      readString(input.payload.reason),
    lifecycleHint: deriveDeliveryLifecycleHint(kind),
  };
}
