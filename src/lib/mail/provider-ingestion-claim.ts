import type { Database } from "@/lib/db";
import {
  buildInboundProviderClaimProcessingUpdate,
  runGuardedUpdate,
} from "@/lib/mail/guarded-batch";
import { computeIngestionProcessingLease } from "@/lib/mail/provider-ingestion-processing-lease";

/**
 * Atomically claim pending provider ingestion for processing with V1 lease.
 */
export async function claimProviderIngestionForProcessing(
  db: Database,
  input: {
    ingestionEventId: string;
    expectedProcessingVersion: number;
    now?: string;
  },
): Promise<number> {
  const lease = computeIngestionProcessingLease(input.now);
  const nextProcessingVersion = input.expectedProcessingVersion + 1;
  await runGuardedUpdate(
    db,
    buildInboundProviderClaimProcessingUpdate(db, {
      ingestionEventId: input.ingestionEventId,
      expectedProcessingVersion: input.expectedProcessingVersion,
      nextProcessingVersion,
      processingStartedAt: lease.processingStartedAt,
      processingLeaseExpiresAt: lease.processingLeaseExpiresAt,
    }),
    "Provider ingestion processing claim failed",
  );
  return nextProcessingVersion;
}
