import { eq } from "drizzle-orm";
import type { MailProviderIngestionEvent } from "../../../drizzle/schema/mail-provider-ingestion-events";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertBatchUpdateChanged,
  buildIngestionProcessingRecoveryAuditInsert,
  buildProviderProcessingRecoveryUpdate,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import {
  getIngestionProcessingTrustNow,
  hasActiveProcessingLease,
  isLegacyUnleasedProcessing,
  isProcessingLeaseExpired,
} from "@/lib/mail/provider-ingestion-processing-lease";
import { assertMailDeliveryHealth } from "@/lib/permissions/mail";

export type ProcessingRecoveryOutcome =
  | "RECOVERED"
  | "RECOVERY_NOT_READY"
  | "LEGACY_PROCESSING_UNLEASED";

export type ProcessingRecoveryResult = {
  outcome: ProcessingRecoveryOutcome;
  ingestionEventId: string;
  eventKind: MailProviderIngestionEvent["eventKind"];
  status: MailProviderIngestionEvent["status"];
  processingVersion: number;
  previousProcessingVersion: number;
  processingStartedAt: string | null;
  leaseExpiredAt: string | null;
  message?: string;
};

export type StuckProcessingListItem = {
  ingestionEventId: string;
  eventKind: MailProviderIngestionEvent["eventKind"];
  provider: string;
  status: MailProviderIngestionEvent["status"];
  processingVersion: number;
  processingStartedAt: string | null;
  processingLeaseExpiresAt: string | null;
  receivedAt: string;
  recoverable: boolean;
  recoveryClassification:
    | "lease_expired"
    | "lease_active"
    | "legacy_unleased";
};

/**
 * Future scheduler/cron should call a dedicated system-internal recovery entry
 * point — NOT impersonate delivery_health or super_admin human actors.
 */
export const PROCESSING_RECOVERY_SYSTEM_ACTOR_BOUNDARY =
  "System recovery must use a separate internal service entry; manual recovery uses delivery_health or super_admin only." as const;

async function findProviderEvent(
  db: Database,
  ingestionEventId: string,
): Promise<MailProviderIngestionEvent | null> {
  const [row] = await db
    .select()
    .from(schema.mailProviderIngestionEvents)
    .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId))
    .limit(1);
  return row ?? null;
}

export async function listStuckProcessingIngestionEvents(
  db: Database,
  actor: MailActorContext,
): Promise<StuckProcessingListItem[]> {
  assertMailDeliveryHealth(actor);

  const trustNow = getIngestionProcessingTrustNow();
  const rows = await db
    .select()
    .from(schema.mailProviderIngestionEvents)
    .where(eq(schema.mailProviderIngestionEvents.status, "processing"));

  return rows.map((row) => {
    if (isLegacyUnleasedProcessing(row)) {
      return {
        ingestionEventId: row.id,
        eventKind: row.eventKind,
        provider: row.provider,
        status: row.status,
        processingVersion: row.processingVersion,
        processingStartedAt: row.processingStartedAt,
        processingLeaseExpiresAt: row.processingLeaseExpiresAt,
        receivedAt: row.receivedAt,
        recoverable: false,
        recoveryClassification: "legacy_unleased" as const,
      };
    }

    const expired = isProcessingLeaseExpired(row, trustNow);
    return {
      ingestionEventId: row.id,
      eventKind: row.eventKind,
      provider: row.provider,
      status: row.status,
      processingVersion: row.processingVersion,
      processingStartedAt: row.processingStartedAt,
      processingLeaseExpiresAt: row.processingLeaseExpiresAt,
      receivedAt: row.receivedAt,
      recoverable: expired,
      recoveryClassification: expired ? ("lease_expired" as const) : ("lease_active" as const),
    };
  });
}

/**
 * Release an abandoned processing claim after lease expiry (Phase 2C.12A.1).
 */
export async function recoverExpiredProcessingIngestionEvent(
  db: Database,
  actor: MailActorContext,
  input: {
    ingestionEventId: string;
    expectedProcessingVersion?: number;
    now?: string;
  },
): Promise<ProcessingRecoveryResult> {
  assertMailDeliveryHealth(actor);

  const providerEvent = await findProviderEvent(db, input.ingestionEventId);
  if (!providerEvent) {
    throw MailServiceError.notFound("Provider ingestion event not found");
  }

  if (providerEvent.status === "completed") {
    throw MailServiceError.validation("Completed ingestion cannot be recovered");
  }

  if (providerEvent.status !== "processing") {
    throw MailServiceError.validation(
      "Only processing ingestion events may be recovered",
      { status: providerEvent.status },
    );
  }

  const trustNow = input.now ?? getIngestionProcessingTrustNow();
  const previousProcessingVersion = providerEvent.processingVersion;
  const expectedProcessingVersion =
    input.expectedProcessingVersion ?? providerEvent.processingVersion;

  if (providerEvent.processingVersion !== expectedProcessingVersion) {
    throw MailServiceError.staleVersion(
      "Processing recovery version mismatch",
    );
  }

  if (isLegacyUnleasedProcessing(providerEvent)) {
    return {
      outcome: "LEGACY_PROCESSING_UNLEASED",
      ingestionEventId: providerEvent.id,
      eventKind: providerEvent.eventKind,
      status: providerEvent.status,
      processingVersion: providerEvent.processingVersion,
      previousProcessingVersion,
      processingStartedAt: null,
      leaseExpiredAt: null,
      message: "Legacy processing row has no durable lease; recovery refused",
    };
  }

  if (!hasActiveProcessingLease(providerEvent)) {
    return {
      outcome: "LEGACY_PROCESSING_UNLEASED",
      ingestionEventId: providerEvent.id,
      eventKind: providerEvent.eventKind,
      status: providerEvent.status,
      processingVersion: providerEvent.processingVersion,
      previousProcessingVersion,
      processingStartedAt: providerEvent.processingStartedAt,
      leaseExpiredAt: providerEvent.processingLeaseExpiresAt,
      message: "Processing lease evidence incomplete; recovery refused",
    };
  }

  if (!isProcessingLeaseExpired(providerEvent, trustNow)) {
    return {
      outcome: "RECOVERY_NOT_READY",
      ingestionEventId: providerEvent.id,
      eventKind: providerEvent.eventKind,
      status: providerEvent.status,
      processingVersion: providerEvent.processingVersion,
      previousProcessingVersion,
      processingStartedAt: providerEvent.processingStartedAt,
      leaseExpiredAt: providerEvent.processingLeaseExpiresAt,
      message: "Processing lease has not expired",
    };
  }

  const nextProcessingVersion = expectedProcessingVersion + 1;
  const auditId = crypto.randomUUID();
  const now = trustNow;
  const results = await runMailBatch(db, [
    buildProviderProcessingRecoveryUpdate(db, {
      ingestionEventId: providerEvent.id,
      expectedProcessingVersion,
      nextProcessingVersion,
      trustNow,
    }),
    buildIngestionProcessingRecoveryAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.ingestionProcessingRecovered,
      ingestionEventId: providerEvent.id,
      nextProcessingVersion,
      metadata: {
        ingestionEventId: providerEvent.id,
        ingestionKind: providerEvent.eventKind,
        previousProcessingVersion,
        newProcessingVersion: nextProcessingVersion,
        processingStartedAt: providerEvent.processingStartedAt,
        leaseExpiredAt: providerEvent.processingLeaseExpiresAt,
      },
    }),
  ]);

  assertBatchUpdateChanged(
    results,
    0,
    "Processing recovery CAS transition failed",
  );

  return {
    outcome: "RECOVERED",
    ingestionEventId: providerEvent.id,
    eventKind: providerEvent.eventKind,
    status: "pending",
    processingVersion: nextProcessingVersion,
    previousProcessingVersion,
    processingStartedAt: providerEvent.processingStartedAt,
    leaseExpiredAt: providerEvent.processingLeaseExpiresAt,
  };
}

/** Query helper for future operator UI — expired leased processing only. */
export async function listExpiredLeasedProcessingEvents(
  db: Database,
  actor: MailActorContext,
): Promise<StuckProcessingListItem[]> {
  const items = await listStuckProcessingIngestionEvents(db, actor);
  return items.filter((item) => item.recoveryClassification === "lease_expired");
}
