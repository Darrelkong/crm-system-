/** Machine-safe quarantine reason codes for delivery provider ingestion (V1). */
export const DELIVERY_QUARANTINE_REASONS = {
  missingProviderMessageId: "missing_provider_message_id",
  missingProviderEventId: "missing_provider_event_id",
  correlationUnresolved: "correlation_unresolved",
  ambiguousTransportAttempt: "ambiguous_transport_attempt",
  recipientNotOnRevision: "recipient_not_on_revision",
  sendNotAccepted: "send_not_accepted",
  transportNotAccepted: "transport_not_accepted",
  dedupeIntegrityConflict: "dedupe_integrity_conflict",
  payloadIntegrityConflict: "payload_integrity_conflict",
  integrityConflict: "integrity_conflict",
} as const;

export type DeliveryQuarantineReason =
  (typeof DELIVERY_QUARANTINE_REASONS)[keyof typeof DELIVERY_QUARANTINE_REASONS];
