import { INBOUND_RAW_PAYLOAD_KEY_PREFIX } from "@/lib/mail/inbound-raw-payload-store";

/**
 * Raw inbound MIME is stored privately under mail/raw-ingestion/.
 * Canonical Mail history (messages, bodies, threads, attachments) is never auto-purged.
 */
export const INBOUND_RAW_MIME_RETENTION_CLASSES = {
  materialized: "materialized",
  quarantined: "quarantined",
  failed: "failed",
} as const;

export type InboundRawMimeRetentionClass =
  (typeof INBOUND_RAW_MIME_RETENTION_CLASSES)[keyof typeof INBOUND_RAW_MIME_RETENTION_CLASSES];

/** Product-approved retention windows — raw MIME only, not canonical Mail history. */
export const COMPLETED_RAW_MIME_RETENTION_DAYS = 14 as const;
export const QUARANTINED_RAW_MIME_RETENTION_DAYS = 60 as const;

/** Canonical mail_messages / threads / bodies / attachments are never TTL-purged. */
export const CANONICAL_MAIL_HISTORY_AUTOMATIC_PURGE = "DISABLED" as const;

export function inboundRawMimeStorageNamespace(): string {
  return INBOUND_RAW_PAYLOAD_KEY_PREFIX;
}

export function subtractRetentionDays(isoTimestamp: string, days: number): string {
  return new Date(Date.parse(isoTimestamp) - days * 24 * 60 * 60 * 1000).toISOString();
}

export function isInboundRawMimeRetentionEligible(input: {
  eventKind: string;
  status: string;
  payloadStorageKey: string | null;
  finalizedAt: string | null;
  trustNow: string;
}): boolean {
  if (input.eventKind !== "inbound_message") {
    return false;
  }
  if (!input.payloadStorageKey || !input.finalizedAt) {
    return false;
  }
  if (input.status === "completed") {
    const cutoff = subtractRetentionDays(
      input.trustNow,
      COMPLETED_RAW_MIME_RETENTION_DAYS,
    );
    return input.finalizedAt <= cutoff;
  }
  if (input.status === "quarantined") {
    const cutoff = subtractRetentionDays(
      input.trustNow,
      QUARANTINED_RAW_MIME_RETENTION_DAYS,
    );
    return input.finalizedAt <= cutoff;
  }
  return false;
}
