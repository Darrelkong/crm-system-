/** Machine-safe quarantine reason codes for provider ingestion (V1). */
export const INBOUND_QUARANTINE_REASONS = {
  unknownReceivingAddress: "unknown_receiving_address",
  receivingAddressSuspended: "receiving_address_suspended",
  receivingAddressRetired: "receiving_address_retired",
  routeOwnerSuspended: "route_owner_suspended",
  fallbackNotConfigured: "fallback_not_configured",
  fallbackUnusable: "fallback_unusable",
  recursiveFallback: "recursive_fallback",
  routingIntegrityConflict: "routing_integrity_conflict",
  integrityConflict: "integrity_conflict",
  payloadIntegrityConflict: "payload_integrity_conflict",
  mimeParseFailure: "mime_parse_failure",
  senderInvariantFailure: "sender_invariant_failure",
  rfcMessageIdCollision: "rfc_message_id_collision",
  materializationTargetUnusable: "materialization_target_unusable",
} as const;

/** Stable historical fallback reasons persisted on materialization rows. */
export const INBOUND_MATERIALIZATION_FALLBACK_REASONS = {
  routeOwnerNonoperationalAtIngestion:
    "route_owner_nonoperational_at_ingestion",
} as const;

export type InboundQuarantineReason =
  (typeof INBOUND_QUARANTINE_REASONS)[keyof typeof INBOUND_QUARANTINE_REASONS];
