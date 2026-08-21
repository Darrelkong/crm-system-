import type { MailProviderIngestionEvent } from "../../../drizzle/schema/mail-provider-ingestion-events";

/** V1 frozen processing lease duration — server-owned, not caller-configurable. */
export const INGESTION_PROCESSING_LEASE_V1_MS = 15 * 60 * 1000;

let testClockNow: string | null = null;

/** Test-only injectable trusted server clock (ISO 8601). */
export function setIngestionProcessingLeaseTestClock(now: string | null): void {
  testClockNow = now;
}

export function getIngestionProcessingTrustNow(): string {
  return testClockNow ?? new Date().toISOString();
}

export function computeIngestionProcessingLease(now?: string): {
  processingStartedAt: string;
  processingLeaseExpiresAt: string;
} {
  const processingStartedAt = now ?? getIngestionProcessingTrustNow();
  const startMs = Date.parse(processingStartedAt);
  if (Number.isNaN(startMs)) {
    throw new Error("Invalid ingestion processing lease timestamp");
  }
  return {
    processingStartedAt,
    processingLeaseExpiresAt: new Date(
      startMs + INGESTION_PROCESSING_LEASE_V1_MS,
    ).toISOString(),
  };
}

export function isLegacyUnleasedProcessing(
  providerEvent: Pick<
    MailProviderIngestionEvent,
    "status" | "processingStartedAt" | "processingLeaseExpiresAt"
  >,
): boolean {
  return (
    providerEvent.status === "processing" &&
    providerEvent.processingStartedAt === null &&
    providerEvent.processingLeaseExpiresAt === null
  );
}

export function hasActiveProcessingLease(
  providerEvent: Pick<
    MailProviderIngestionEvent,
    "processingStartedAt" | "processingLeaseExpiresAt"
  >,
): boolean {
  return (
    providerEvent.processingStartedAt !== null &&
    providerEvent.processingLeaseExpiresAt !== null
  );
}

export function isProcessingLeaseExpired(
  providerEvent: Pick<
    MailProviderIngestionEvent,
    "processingStartedAt" | "processingLeaseExpiresAt"
  >,
  now?: string,
): boolean {
  if (!hasActiveProcessingLease(providerEvent)) {
    return false;
  }
  const trustNow = now ?? getIngestionProcessingTrustNow();
  return providerEvent.processingLeaseExpiresAt! <= trustNow;
}

export function isProcessingLeaseActive(
  providerEvent: Pick<
    MailProviderIngestionEvent,
    "processingStartedAt" | "processingLeaseExpiresAt"
  >,
  now?: string,
): boolean {
  return (
    hasActiveProcessingLease(providerEvent) &&
    !isProcessingLeaseExpired(providerEvent, now)
  );
}
