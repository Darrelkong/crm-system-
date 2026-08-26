import { eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { InboundAttachmentStore } from "@/lib/mail/inbound-attachment-store";
import type { InboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import {
  DeliveryCorrelationPendingError,
  materializeDeliveryIngestionEvent,
} from "@/lib/mail/delivery-event-materialization-service";
import { materializeInboundIngestionEvent } from "@/lib/mail/inbound-message-materialization-service";
import { recoverExpiredProcessingIngestionEventAsSystem } from "@/lib/mail/ingestion-processing-recovery-service";
import {
  listDueDeliveryProviderIngestionEvents,
  listDueGeneralNotificationOutboxEvents,
  listDueInboundProviderIngestionEvents,
  listDueVerificationNotificationOutboxEvents,
  listExpiredLeasedProviderIngestionEvents,
  listExpiredNotificationProcessingEvents,
} from "@/lib/mail/mail-background-due-work-queries";
import {
  MAIL_BACKGROUND_MAX_ITEMS_PER_CATEGORY,
  MAIL_BACKGROUND_MAX_TOTAL_ITEMS_PER_TICK,
  MAIL_BACKGROUND_SOFT_WALL_CLOCK_BUDGET_MS,
} from "@/lib/mail/mail-background-tick-constants";
import type { NotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import {
  claimNotificationOutboxForProcessing,
  processClaimedVerificationOutboxDelivery,
} from "@/lib/mail/notification-verification-outbox-processing-service";
import {
  processClaimedNotificationOutbox,
  recoverExpiredNotificationProcessingAsSystem,
} from "@/lib/mail/notification-outbox-processing-service";
import type { NotificationTransportAdapter } from "@/lib/mail/notification-transport-adapter";
import {
  emptyInboundRawMimeRetentionCounters,
  runInboundRawMimeRetentionCleanup,
  type InboundRawMimeRetentionTickCounters,
} from "@/lib/mail/inbound-raw-mime-retention-service";
import { getIngestionProcessingTrustNow } from "@/lib/mail/provider-ingestion-processing-lease";
import { getNotificationProcessingTrustNow } from "@/lib/mail/notification-processing-lease";
import { SYSTEM_MAIL_ACTOR } from "@/lib/mail/system-mail-actor";

/**
 * FakeNotificationTransportAdapter is test/local only.
 * Background service must NOT infer "no real provider configured → use Fake".
 * FAKE ADAPTER AUTOMATIC PRODUCTION FALLBACK: NO
 */
export type MailBackgroundTickStopReason =
  | "total_limit"
  | "time_budget"
  | "infrastructure_failure";

export type MailBackgroundTickCategoryCounters = {
  selected: number;
  claimed: number;
  completed: number;
  recovered: number;
  quarantined: number;
  retryScheduled: number;
  permanentFailed: number;
  skipped: number;
  errors: number;
};

export type MailBackgroundTickSummary = {
  providerProcessingRecovery: MailBackgroundTickCategoryCounters;
  notificationProcessingRecovery: MailBackgroundTickCategoryCounters;
  inboundMaterialization: MailBackgroundTickCategoryCounters;
  deliveryMaterialization: MailBackgroundTickCategoryCounters;
  notificationDispatch: MailBackgroundTickCategoryCounters;
  notificationDispatchSkipped: boolean;
  verificationDispatch: MailBackgroundTickCategoryCounters;
  verificationDispatchSkipped: boolean;
  rawPayloadRetention: InboundRawMimeRetentionTickCounters;
  totalItemsStarted: number;
  stoppedReason?: MailBackgroundTickStopReason;
};

export type MailBackgroundTickDeps = {
  rawPayloadStore: InboundRawPayloadStore;
  attachmentStore: InboundAttachmentStore;
  /** Explicit transport only — omit to skip notification dispatch (production-safe default). */
  notificationTransport?: NotificationTransportAdapter;
  /** Verification challenge sink — omit to skip verification dispatch. */
  verificationChallengeSink?: NotificationVerificationChallengeSink;
  trustNow?: () => string;
  /** Injectable elapsed milliseconds for soft wall-clock budget tests. */
  elapsedMs?: () => number;
};

export type MailBackgroundTickOptions = {
  maxItemsPerCategory?: number;
  maxTotalItems?: number;
  softWallClockBudgetMs?: number;
};

function emptyCounters(): MailBackgroundTickCategoryCounters {
  return {
    selected: 0,
    claimed: 0,
    completed: 0,
    recovered: 0,
    quarantined: 0,
    retryScheduled: 0,
    permanentFailed: 0,
    skipped: 0,
    errors: 0,
  };
}

function isInfrastructureWideFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("d1") ||
    message.includes("database binding") ||
    message.includes("r2 binding is required") ||
    message.includes("attachments r2 binding")
  );
}

async function readProviderStatus(
  db: Database,
  ingestionEventId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ status: schema.mailProviderIngestionEvents.status })
    .from(schema.mailProviderIngestionEvents)
    .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId))
    .limit(1);
  return row?.status ?? null;
}

export async function runMailBackgroundTick(
  db: Database,
  deps: MailBackgroundTickDeps,
  options?: MailBackgroundTickOptions,
): Promise<MailBackgroundTickSummary> {
  const maxItemsPerCategory =
    options?.maxItemsPerCategory ?? MAIL_BACKGROUND_MAX_ITEMS_PER_CATEGORY;
  const maxTotalItems =
    options?.maxTotalItems ?? MAIL_BACKGROUND_MAX_TOTAL_ITEMS_PER_TICK;
  const softWallClockBudgetMs =
    options?.softWallClockBudgetMs ?? MAIL_BACKGROUND_SOFT_WALL_CLOCK_BUDGET_MS;

  const tickStartMs = Date.now();
  const elapsedMs = (): number =>
    deps.elapsedMs ? deps.elapsedMs() : Date.now() - tickStartMs;

  const summary: MailBackgroundTickSummary = {
    providerProcessingRecovery: emptyCounters(),
    notificationProcessingRecovery: emptyCounters(),
    inboundMaterialization: emptyCounters(),
    deliveryMaterialization: emptyCounters(),
    notificationDispatch: emptyCounters(),
    notificationDispatchSkipped: deps.notificationTransport === undefined,
    verificationDispatch: emptyCounters(),
    verificationDispatchSkipped: deps.verificationChallengeSink === undefined,
    rawPayloadRetention: emptyInboundRawMimeRetentionCounters(),
    totalItemsStarted: 0,
  };

  const providerTrustNow = deps.trustNow?.() ?? getIngestionProcessingTrustNow();
  const notificationTrustNow =
    deps.trustNow?.() ?? getNotificationProcessingTrustNow();

  const markTotalLimitReached = (): boolean => {
    if (summary.totalItemsStarted >= maxTotalItems) {
      summary.stoppedReason = "total_limit";
      return true;
    }
    return false;
  };

  const shouldStop = (): MailBackgroundTickStopReason | null => {
    if (summary.totalItemsStarted >= maxTotalItems) {
      return "total_limit";
    }
    if (elapsedMs() >= softWallClockBudgetMs) {
      return "time_budget";
    }
    return null;
  };

  const remainingCategoryLimit = (): number =>
    Math.min(
      maxItemsPerCategory,
      maxTotalItems - summary.totalItemsStarted,
    );

  const runCategoryItem = async (
    run: () => Promise<void>,
  ): Promise<"ok" | "infrastructure_failure"> => {
    summary.totalItemsStarted += 1;
    try {
      await run();
      return "ok";
    } catch (error) {
      if (isInfrastructureWideFailure(error)) {
        summary.stoppedReason = "infrastructure_failure";
        return "infrastructure_failure";
      }
      throw error;
    }
  };

  // 1. Recover expired provider processing
  if (!summary.stoppedReason) {
    const rows = await listExpiredLeasedProviderIngestionEvents(db, {
      trustNow: providerTrustNow,
      limit: remainingCategoryLimit(),
    });
    summary.providerProcessingRecovery.selected = rows.length;

    for (const row of rows) {
      const stop = shouldStop();
      if (stop) {
        summary.stoppedReason = stop;
        break;
      }
      const outcome = await runCategoryItem(async () => {
        const result = await recoverExpiredProcessingIngestionEventAsSystem(db, {
          ingestionEventId: row.id,
          expectedProcessingVersion: row.processingVersion,
          now: providerTrustNow,
        });
        if (result.outcome === "RECOVERED") {
          summary.providerProcessingRecovery.recovered += 1;
          summary.providerProcessingRecovery.completed += 1;
        } else {
          summary.providerProcessingRecovery.skipped += 1;
        }
      });
      if (outcome === "infrastructure_failure") break;
      if (markTotalLimitReached()) break;
    }
  }

  // 2. Recover expired notification processing
  if (!summary.stoppedReason) {
    const rows = await listExpiredNotificationProcessingEvents(db, {
      trustNow: notificationTrustNow,
      limit: remainingCategoryLimit(),
    });
    summary.notificationProcessingRecovery.selected = rows.length;

    for (const row of rows) {
      const stop = shouldStop();
      if (stop) {
        summary.stoppedReason = stop;
        break;
      }
      const outcome = await runCategoryItem(async () => {
        const result = await recoverExpiredNotificationProcessingAsSystem(
          db,
          row.id,
        );
        if (result.outcome === "RECOVERED_TO_PENDING") {
          summary.notificationProcessingRecovery.recovered += 1;
          summary.notificationProcessingRecovery.completed += 1;
        } else if (result.outcome === "AMBIGUOUS_TERMINALIZED") {
          summary.notificationProcessingRecovery.permanentFailed += 1;
          summary.notificationProcessingRecovery.completed += 1;
        } else {
          summary.notificationProcessingRecovery.skipped += 1;
        }
      });
      if (outcome === "infrastructure_failure") break;
      if (markTotalLimitReached()) break;
    }
  }

  // 3. Process due inbound materialization
  if (!summary.stoppedReason) {
    const rows = await listDueInboundProviderIngestionEvents(db, {
      trustNow: providerTrustNow,
      limit: remainingCategoryLimit(),
    });
    summary.inboundMaterialization.selected = rows.length;

    for (const row of rows) {
      const stop = shouldStop();
      if (stop) {
        summary.stoppedReason = stop;
        break;
      }
      const outcome = await runCategoryItem(async () => {
        try {
          await materializeInboundIngestionEvent(
            db,
            {
              rawPayloadStore: deps.rawPayloadStore,
              attachmentStore: deps.attachmentStore,
            },
            {
              ingestionEventId: row.id,
              expectedProcessingVersion: row.processingVersion,
            },
          );
          summary.inboundMaterialization.completed += 1;
        } catch {
          const status = await readProviderStatus(db, row.id);
          if (status === "quarantined") {
            summary.inboundMaterialization.quarantined += 1;
          } else {
            summary.inboundMaterialization.errors += 1;
          }
        }
      });
      if (outcome === "infrastructure_failure") break;
      if (markTotalLimitReached()) break;
    }
  }

  // 4. Process due delivery materialization
  if (!summary.stoppedReason) {
    const rows = await listDueDeliveryProviderIngestionEvents(db, {
      trustNow: providerTrustNow,
      limit: remainingCategoryLimit(),
    });
    summary.deliveryMaterialization.selected = rows.length;

    for (const row of rows) {
      const stop = shouldStop();
      if (stop) {
        summary.stoppedReason = stop;
        break;
      }
      const outcome = await runCategoryItem(async () => {
        try {
          await materializeDeliveryIngestionEvent(db, {
            ingestionEventId: row.id,
            expectedProcessingVersion: row.processingVersion,
          });
          summary.deliveryMaterialization.completed += 1;
        } catch (error) {
          if (error instanceof DeliveryCorrelationPendingError) {
            summary.deliveryMaterialization.retryScheduled += 1;
            return;
          }
          const status = await readProviderStatus(db, row.id);
          if (status === "quarantined") {
            summary.deliveryMaterialization.quarantined += 1;
          } else {
            summary.deliveryMaterialization.errors += 1;
          }
        }
      });
      if (outcome === "infrastructure_failure") break;
      if (markTotalLimitReached()) break;
    }
  }

  // 5. Process due general notification outbox — skipped when transport absent
  if (!summary.stoppedReason && deps.notificationTransport) {
    const rows = await listDueGeneralNotificationOutboxEvents(db, {
      trustNow: notificationTrustNow,
      limit: remainingCategoryLimit(),
    });
    summary.notificationDispatch.selected = rows.length;

    for (const row of rows) {
      const stop = shouldStop();
      if (stop) {
        summary.stoppedReason = stop;
        break;
      }
      const outcome = await runCategoryItem(async () => {
        const claim = await claimNotificationOutboxForProcessing(db, {
          outboxId: row.id,
          expectedProcessingVersion: row.processingVersion,
        });
        if (!claim.claimed) {
          summary.notificationDispatch.skipped += 1;
          return;
        }
        summary.notificationDispatch.claimed += 1;

        try {
          const processed = await processClaimedNotificationOutbox(
            db,
            SYSTEM_MAIL_ACTOR,
            {
              outboxId: row.id,
              adapter: deps.notificationTransport!,
            },
          );
          if (processed.outcome === "sent") {
            summary.notificationDispatch.completed += 1;
          } else if (processed.outcome === "failed_retryable") {
            summary.notificationDispatch.retryScheduled += 1;
          } else if (processed.outcome === "failed_permanent") {
            summary.notificationDispatch.permanentFailed += 1;
          } else if (processed.outcome === "skipped") {
            summary.notificationDispatch.skipped += 1;
          }
        } catch (error) {
          if (isInfrastructureWideFailure(error)) {
            throw error;
          }
          summary.notificationDispatch.errors += 1;
        }
      });
      if (outcome === "infrastructure_failure") break;
      if (markTotalLimitReached()) break;
    }
  }

  // 6. Process due verification outbox — skipped when verification sink absent
  if (!summary.stoppedReason && deps.verificationChallengeSink) {
    const rows = await listDueVerificationNotificationOutboxEvents(db, {
      trustNow: notificationTrustNow,
      limit: remainingCategoryLimit(),
    });
    summary.verificationDispatch.selected = rows.length;

    for (const row of rows) {
      const stop = shouldStop();
      if (stop) {
        summary.stoppedReason = stop;
        break;
      }
      const outcome = await runCategoryItem(async () => {
        const claim = await claimNotificationOutboxForProcessing(db, {
          outboxId: row.id,
          expectedProcessingVersion: row.processingVersion,
        });
        if (!claim.claimed) {
          summary.verificationDispatch.skipped += 1;
          return;
        }
        summary.verificationDispatch.claimed += 1;

        try {
          const processed = await processClaimedVerificationOutboxDelivery(
            db,
            SYSTEM_MAIL_ACTOR,
            {
              outboxId: row.id,
              sink: deps.verificationChallengeSink!,
            },
          );
          if (processed.outcome === "sent") {
            summary.verificationDispatch.completed += 1;
          } else if (processed.outcome === "failed_retryable") {
            summary.verificationDispatch.retryScheduled += 1;
          } else if (processed.outcome === "failed_permanent") {
            summary.verificationDispatch.permanentFailed += 1;
          } else if (processed.outcome === "skipped") {
            summary.verificationDispatch.skipped += 1;
          }
        } catch (error) {
          if (isInfrastructureWideFailure(error)) {
            throw error;
          }
          summary.verificationDispatch.errors += 1;
        }
      });
      if (outcome === "infrastructure_failure") break;
      if (markTotalLimitReached()) break;
    }
  }

  // 7. Purge expired inbound raw MIME objects (canonical Mail history preserved)
  if (!summary.stoppedReason) {
    summary.rawPayloadRetention = await runInboundRawMimeRetentionCleanup(
      db,
      deps.rawPayloadStore,
      {
        trustNow: providerTrustNow,
        limit: remainingCategoryLimit(),
      },
    );
  }

  return summary;
}
