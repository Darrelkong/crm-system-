import type { MailNotificationOutbox } from "../../../drizzle/schema/mail-notification-outbox";
import { NOTIFICATION_PROCESSING_LEASE_V1_MS } from "@/lib/mail/notification-outbox-constants";

let testClockNow: string | null = null;

/** Test-only injectable trusted server clock (ISO 8601). */
export function setNotificationProcessingLeaseTestClock(now: string | null): void {
  testClockNow = now;
}

export function getNotificationProcessingTrustNow(): string {
  return testClockNow ?? new Date().toISOString();
}

export function computeNotificationProcessingLease(now?: string): {
  processingStartedAt: string;
  processingLeaseExpiresAt: string;
} {
  const processingStartedAt = now ?? getNotificationProcessingTrustNow();
  const startMs = Date.parse(processingStartedAt);
  if (Number.isNaN(startMs)) {
    throw new Error("Invalid notification processing lease timestamp");
  }
  return {
    processingStartedAt,
    processingLeaseExpiresAt: new Date(
      startMs + NOTIFICATION_PROCESSING_LEASE_V1_MS,
    ).toISOString(),
  };
}

export function hasActiveNotificationProcessingLease(
  outbox: Pick<
    MailNotificationOutbox,
    "processingStartedAt" | "processingLeaseExpiresAt"
  >,
): boolean {
  return (
    outbox.processingStartedAt !== null &&
    outbox.processingLeaseExpiresAt !== null
  );
}

export function isNotificationProcessingLeaseExpired(
  outbox: Pick<
    MailNotificationOutbox,
    "processingStartedAt" | "processingLeaseExpiresAt"
  >,
  now?: string,
): boolean {
  if (!hasActiveNotificationProcessingLease(outbox)) {
    return false;
  }
  const trustNow = now ?? getNotificationProcessingTrustNow();
  return outbox.processingLeaseExpiresAt! <= trustNow;
}

export function isNotificationProcessingLeaseActive(
  outbox: Pick<
    MailNotificationOutbox,
    "processingStartedAt" | "processingLeaseExpiresAt"
  >,
  now?: string,
): boolean {
  return (
    hasActiveNotificationProcessingLease(outbox) &&
    !isNotificationProcessingLeaseExpired(outbox, now)
  );
}
