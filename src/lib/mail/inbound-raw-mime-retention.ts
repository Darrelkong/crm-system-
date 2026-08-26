import { INBOUND_RAW_PAYLOAD_KEY_PREFIX } from "@/lib/mail/inbound-raw-payload-store";

/**
 * Raw inbound MIME is stored privately under mail/raw-ingestion/ with no TTL today.
 * Lifecycle distinction supports a future privacy retention policy without inventing one here.
 */
export const INBOUND_RAW_MIME_RETENTION_CLASSES = {
  materialized: "materialized",
  quarantined: "quarantined",
  failed: "failed",
} as const;

export type InboundRawMimeRetentionClass =
  (typeof INBOUND_RAW_MIME_RETENTION_CLASSES)[keyof typeof INBOUND_RAW_MIME_RETENTION_CLASSES];

/** Explicit activation gate — approved retention policy required before real Daniel routing. */
export const RAW_MIME_RETENTION_POLICY_REQUIRED_BEFORE_ACTIVATION = true as const;

export function inboundRawMimeStorageNamespace(): string {
  return INBOUND_RAW_PAYLOAD_KEY_PREFIX;
}
