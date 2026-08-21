import { eq } from "drizzle-orm";
import type {
  MailDeliveryEvent,
  MailDeliveryEventType,
} from "../../../drizzle/schema/mail-delivery-events";
import type { MailDeliveryEventMaterialization } from "../../../drizzle/schema/mail-delivery-event-materializations";
import type { MailDeliveryIngestionEvent } from "../../../drizzle/schema/mail-delivery-ingestion-events";
import type { MailProviderIngestionEvent } from "../../../drizzle/schema/mail-provider-ingestion-events";
import { schema, type Database } from "@/lib/db";
import { MAIL_AUDIT_ACTIONS, MAIL_ERROR_CODES } from "@/lib/mail/constants";
import {
  assertDeliveryEventSemanticGraphsEqual,
  deliveryEventSemanticGraphsEqual,
  type DeliveryEventSemanticGraph,
} from "@/lib/mail/delivery-event-semantic-comparison";
import { DELIVERY_QUARANTINE_REASONS } from "@/lib/mail/delivery-quarantine-reasons";
import {
  correlationFailureToQuarantineReason,
  correlateDeliveryRecipient,
  isDeterministicCorrelationFailure,
  type ResolvedDeliveryCorrelation,
} from "@/lib/mail/delivery-recipient-correlation";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertBatchUpdateChanged,
  buildDeliveryMaterializationGuardedAuditInsert,
  buildDeliveryMaterializationGuardedInsert,
  buildInboundProviderCompletedCasUpdate,
  buildInboundProviderQuarantineUpdate,
  buildProviderReleasePendingUpdate,
  runGuardedUpdate,
  runMailBatch,
  type DeliveryMaterializationPostStateGuard,
} from "@/lib/mail/guarded-batch";
import { claimProviderIngestionForProcessing } from "@/lib/mail/provider-ingestion-claim";

export type MaterializeDeliveryIngestionEventResult = {
  materialization: MailDeliveryEventMaterialization;
  deliveryEvent: MailDeliveryEvent;
  convergedExistingDeliveryEvent: boolean;
};

export class DeliveryCorrelationPendingError extends Error {
  constructor(message = "Delivery correlation pending — retry later") {
    super(message);
    this.name = "DeliveryCorrelationPendingError";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /UNIQUE constraint failed/i.test(message);
}

function isOperationalInfrastructureError(error: unknown): boolean {
  if (error instanceof MailServiceError) {
    return false;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /network|timeout|temporarily unavailable|ECONN|D1_ERROR/i.test(message);
}

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

async function findDeliveryChild(
  db: Database,
  ingestionEventId: string,
): Promise<MailDeliveryIngestionEvent | null> {
  const [row] = await db
    .select()
    .from(schema.mailDeliveryIngestionEvents)
    .where(eq(schema.mailDeliveryIngestionEvents.ingestionEventId, ingestionEventId))
    .limit(1);
  return row ?? null;
}

async function findExistingMaterialization(
  db: Database,
  ingestionEventId: string,
): Promise<MailDeliveryEventMaterialization | null> {
  const [row] = await db
    .select()
    .from(schema.mailDeliveryEventMaterializations)
    .where(
      eq(schema.mailDeliveryEventMaterializations.ingestionEventId, ingestionEventId),
    )
    .limit(1);
  return row ?? null;
}

async function findDeliveryEventByDedupeKey(
  db: Database,
  eventDedupeKey: string,
): Promise<MailDeliveryEvent | null> {
  const [row] = await db
    .select()
    .from(schema.mailDeliveryEvents)
    .where(eq(schema.mailDeliveryEvents.eventDedupeKey, eventDedupeKey))
    .limit(1);
  return row ?? null;
}

async function findDeliveryEventById(
  db: Database,
  deliveryEventId: string,
): Promise<MailDeliveryEvent | null> {
  const [row] = await db
    .select()
    .from(schema.mailDeliveryEvents)
    .where(eq(schema.mailDeliveryEvents.id, deliveryEventId))
    .limit(1);
  return row ?? null;
}

function semanticGraphFromDeliveryEvent(
  event: MailDeliveryEvent,
): DeliveryEventSemanticGraph {
  return {
    sendOperationId: event.sendOperationId,
    transportAttemptId: event.transportAttemptId,
    outboundRevisionId: event.outboundRevisionId,
    outboundRevisionRecipientId: event.outboundRevisionRecipientId,
    eventType: event.eventType,
    eventDedupeKey: event.eventDedupeKey,
    providerEventId: event.providerEventId,
    providerOccurredAt: event.providerOccurredAt,
    smtpStatusCode: event.smtpStatusCode,
    smtpEnhancedStatusCode: event.smtpEnhancedStatusCode,
    diagnosticMessage: event.diagnosticMessage,
  };
}

function semanticGraphFromInputs(input: {
  correlation: ResolvedDeliveryCorrelation;
  deliveryChild: MailDeliveryIngestionEvent;
  providerEvent: MailProviderIngestionEvent;
  eventDedupeKey: string;
}): DeliveryEventSemanticGraph {
  return {
    sendOperationId: input.correlation.sendOperationId,
    transportAttemptId: input.correlation.transportAttemptId,
    outboundRevisionId: input.correlation.outboundRevisionId,
    outboundRevisionRecipientId: input.correlation.outboundRevisionRecipientId,
    eventType: input.deliveryChild.deliveryEventType,
    eventDedupeKey: input.eventDedupeKey,
    providerEventId: input.providerEvent.providerEventId,
    providerOccurredAt: input.deliveryChild.providerOccurredAt,
    smtpStatusCode: input.deliveryChild.smtpStatusCode,
    smtpEnhancedStatusCode: input.deliveryChild.smtpEnhancedStatusCode,
    diagnosticMessage: input.deliveryChild.diagnosticMessage,
  };
}

async function resolveMaterializationCorrelation(
  db: Database,
  providerEvent: MailProviderIngestionEvent,
  deliveryChild: MailDeliveryIngestionEvent,
): Promise<ResolvedDeliveryCorrelation> {
  const correlationResult = await correlateDeliveryRecipient(db, {
    provider: providerEvent.provider,
    providerMessageId: providerEvent.providerMessageId,
    recipientAddress: deliveryChild.recipientAddress,
  });

  if (deliveryChild.correlatedAt) {
    if (correlationResult.status !== "resolved") {
      throw MailServiceError.integrityConflict(
        "Frozen delivery correlation no longer resolves",
        { ingestionEventId: providerEvent.id },
      );
    }
    const frozen = {
      sendOperationId: deliveryChild.sendOperationId!,
      transportAttemptId: deliveryChild.transportAttemptId!,
      outboundRevisionId: deliveryChild.outboundRevisionId!,
      outboundRevisionRecipientId: deliveryChild.outboundRevisionRecipientId!,
    };
    const live = correlationResult.correlation;
    if (
      frozen.sendOperationId !== live.sendOperationId ||
      frozen.transportAttemptId !== live.transportAttemptId ||
      frozen.outboundRevisionId !== live.outboundRevisionId ||
      frozen.outboundRevisionRecipientId !== live.outboundRevisionRecipientId
    ) {
      throw MailServiceError.integrityConflict(
        "Frozen delivery correlation conflicts with live resolution",
        { ingestionEventId: providerEvent.id },
      );
    }
    return {
      ...live,
      correlatedAt: deliveryChild.correlatedAt,
    };
  }

  if (correlationResult.status === "resolved") {
    return correlationResult.correlation;
  }

  if (isDeterministicCorrelationFailure(correlationResult)) {
    throw MailServiceError.integrityConflict(
      "Delivery correlation integrity conflict",
      {
        reason: correlationResult.reason,
        ingestionEventId: providerEvent.id,
      },
    );
  }

  throw new DeliveryCorrelationPendingError(
    correlationResult.status === "unresolved"
      ? correlationResult.reason
      : "correlation_pending",
  );
}

async function claimDeliveryProcessing(
  db: Database,
  providerEvent: MailProviderIngestionEvent,
  expectedProcessingVersion?: number,
): Promise<number> {
  if (providerEvent.status === "processing") {
    const version = expectedProcessingVersion ?? providerEvent.processingVersion;
    if (providerEvent.processingVersion !== version) {
      throw MailServiceError.staleVersion(
        "Delivery ingestion processing version mismatch",
      );
    }
    return providerEvent.processingVersion;
  }

  if (providerEvent.status !== "pending") {
    throw MailServiceError.validation(
      "Only pending delivery ingestion events may be materialized",
      { status: providerEvent.status },
    );
  }

  const expectedVersion =
    expectedProcessingVersion ?? providerEvent.processingVersion;
  if (providerEvent.processingVersion !== expectedVersion) {
    throw MailServiceError.staleVersion(
      "Delivery ingestion processing version mismatch",
    );
  }

  const nextVersion = expectedVersion + 1;
  await claimProviderIngestionForProcessing(db, {
    ingestionEventId: providerEvent.id,
    expectedProcessingVersion: expectedVersion,
  });
  return nextVersion;
}

async function releaseDeliveryPending(
  db: Database,
  input: {
    ingestionEventId: string;
    processingVersion: number;
  },
): Promise<void> {
  await runGuardedUpdate(
    db,
    buildProviderReleasePendingUpdate(db, {
      ingestionEventId: input.ingestionEventId,
      processingProcessingVersion: input.processingVersion,
      nextProcessingVersion: input.processingVersion + 1,
    }),
    "Delivery ingestion release to pending failed",
  );
}

async function quarantineDeliveryIngestion(
  db: Database,
  input: {
    ingestionEventId: string;
    processingVersion: number;
    quarantineReason: string;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await runGuardedUpdate(
    db,
    buildInboundProviderQuarantineUpdate(db, {
      ingestionEventId: input.ingestionEventId,
      processingProcessingVersion: input.processingVersion,
      nextProcessingVersion: input.processingVersion + 1,
      finalizedAt: now,
      quarantineReason: input.quarantineReason,
      errorCode: input.errorCode ?? MAIL_ERROR_CODES.INTEGRITY_CONFLICT,
      errorMessage: input.errorMessage ?? null,
    }),
    "Delivery ingestion quarantine transition failed",
  );
}

async function buildResultFromMaterialization(
  db: Database,
  materialization: MailDeliveryEventMaterialization,
  convergedExistingDeliveryEvent: boolean,
): Promise<MaterializeDeliveryIngestionEventResult> {
  const deliveryEvent = await findDeliveryEventById(
    db,
    materialization.deliveryEventId,
  );
  if (!deliveryEvent) {
    throw MailServiceError.conflict("Materialized delivery event missing after batch");
  }
  return {
    materialization,
    deliveryEvent,
    convergedExistingDeliveryEvent,
  };
}

async function finalizeDeliveryMaterializationBatch(
  db: Database,
  input: {
    guard: DeliveryMaterializationPostStateGuard;
    processingVersion: number;
    materializationId: string;
    deliveryEventId: string;
    eventDedupeKey: string;
    deliveryEventType: string;
    providerEvent: MailProviderIngestionEvent;
    correlation: ResolvedDeliveryCorrelation;
    deliveryChild: MailDeliveryIngestionEvent;
    insertDeliveryEvent: boolean;
    deliveryEventValues: {
      sendOperationId: string;
      transportAttemptId: string;
      outboundRevisionId: string;
      outboundRevisionRecipientId: string;
      eventType: MailDeliveryEventType;
      eventDedupeKey: string;
      providerEventId: string | null;
      providerOccurredAt: string | null;
      receivedAt: string;
      smtpStatusCode: string | null;
      smtpEnhancedStatusCode: string | null;
      diagnosticMessage: string | null;
    };
    auditMetadata: Record<string, unknown>;
  },
): Promise<MailDeliveryEventMaterialization> {
  const now = new Date().toISOString();
  const statements = [];

  if (!input.deliveryChild.correlatedAt) {
    statements.push(
      db
        .update(schema.mailDeliveryIngestionEvents)
        .set({
          sendOperationId: input.correlation.sendOperationId,
          transportAttemptId: input.correlation.transportAttemptId,
          outboundRevisionId: input.correlation.outboundRevisionId,
          outboundRevisionRecipientId:
            input.correlation.outboundRevisionRecipientId,
          correlatedAt: input.correlation.correlatedAt,
        })
        .where(
          eq(
            schema.mailDeliveryIngestionEvents.ingestionEventId,
            input.providerEvent.id,
          ),
        ),
    );
  }

  if (input.insertDeliveryEvent) {
    statements.push(
      db.insert(schema.mailDeliveryEvents).values({
        id: input.deliveryEventId,
        ...input.deliveryEventValues,
      }),
    );
  }

  statements.push(
    buildInboundProviderCompletedCasUpdate(db, input.guard, {
      processingProcessingVersion: input.processingVersion,
      finalizedAt: now,
    }),
    buildDeliveryMaterializationGuardedInsert(db, input.guard, {
      id: input.materializationId,
      deliveryEventId: input.deliveryEventId,
      eventDedupeKey: input.eventDedupeKey,
      deliveryEventType: input.deliveryEventType,
      materializedAt: now,
    }),
    buildDeliveryMaterializationGuardedAuditInsert(db, {
      auditId: crypto.randomUUID(),
      now,
      action: MAIL_AUDIT_ACTIONS.deliveryMaterialized,
      ingestionEventId: input.providerEvent.id,
      metadata: input.auditMetadata,
    }),
  );

  const results = await runMailBatch(db, statements);
  const completedIndex = statements.length - 3;
  assertBatchUpdateChanged(results, completedIndex, "Delivery completion CAS failed");

  const materialization = await findExistingMaterialization(
    db,
    input.providerEvent.id,
  );
  if (!materialization) {
    throw MailServiceError.conflict("Delivery materialization missing after batch");
  }
  return materialization;
}

/**
 * Materialize a staged delivery provider ingestion event into canonical
 * mail_delivery_events + provenance (Phase 2C.11).
 */
export async function materializeDeliveryIngestionEvent(
  db: Database,
  input: {
    ingestionEventId: string;
    expectedProcessingVersion?: number;
  },
): Promise<MaterializeDeliveryIngestionEventResult> {
  const existingMaterialization = await findExistingMaterialization(
    db,
    input.ingestionEventId,
  );
  if (existingMaterialization) {
    return buildResultFromMaterialization(db, existingMaterialization, false);
  }

  const providerEvent = await findProviderEvent(db, input.ingestionEventId);
  if (!providerEvent) {
    throw MailServiceError.notFound("Provider ingestion event not found");
  }
  if (providerEvent.eventKind !== "delivery_event") {
    throw MailServiceError.validation("Not a delivery provider ingestion event");
  }
  if (providerEvent.status === "quarantined") {
    throw MailServiceError.validation("Quarantined delivery ingestion cannot materialize", {
      quarantineReason: providerEvent.quarantineReason,
    });
  }
  if (providerEvent.status === "completed") {
    const raced = await findExistingMaterialization(db, input.ingestionEventId);
    if (raced) {
      return buildResultFromMaterialization(db, raced, false);
    }
    throw MailServiceError.integrityConflict(
      "Completed delivery ingestion without materialization",
    );
  }

  const deliveryChild = await findDeliveryChild(db, input.ingestionEventId);
  if (!deliveryChild) {
    throw MailServiceError.integrityConflict("Delivery ingestion child missing");
  }

  let processingVersion: number;
  try {
    processingVersion = await claimDeliveryProcessing(
      db,
      providerEvent,
      input.expectedProcessingVersion,
    );
  } catch (error) {
    if (
      error instanceof MailServiceError &&
      error.errorCode === MAIL_ERROR_CODES.STALE_VERSION
    ) {
      const raced = await findExistingMaterialization(db, input.ingestionEventId);
      if (raced) {
        return buildResultFromMaterialization(db, raced, false);
      }
    }
    throw error;
  }

  try {
    const correlation = await resolveMaterializationCorrelation(
      db,
      providerEvent,
      deliveryChild,
    );

    const eventDedupeKey = providerEvent.ingestionDedupeKey;
    const candidateGraph = semanticGraphFromInputs({
      correlation,
      deliveryChild,
      providerEvent,
      eventDedupeKey,
    });

    const existingDeliveryEvent = await findDeliveryEventByDedupeKey(
      db,
      eventDedupeKey,
    );

    let deliveryEventId: string;
    let insertDeliveryEvent = true;
    let convergedExistingDeliveryEvent = false;

    if (existingDeliveryEvent) {
      assertDeliveryEventSemanticGraphsEqual(
        candidateGraph,
        semanticGraphFromDeliveryEvent(existingDeliveryEvent),
      );
      deliveryEventId = existingDeliveryEvent.id;
      insertDeliveryEvent = false;
      convergedExistingDeliveryEvent = true;
    } else {
      deliveryEventId = crypto.randomUUID();
    }

    const completedProcessingVersion = processingVersion + 1;
    const guard: DeliveryMaterializationPostStateGuard = {
      ingestionEventId: input.ingestionEventId,
      completedProcessingVersion,
    };

    try {
      const materialization = await finalizeDeliveryMaterializationBatch(db, {
        guard,
        processingVersion,
        materializationId: crypto.randomUUID(),
        deliveryEventId,
        eventDedupeKey,
        deliveryEventType: deliveryChild.deliveryEventType,
        providerEvent,
        correlation,
        deliveryChild,
        insertDeliveryEvent,
        deliveryEventValues: {
          sendOperationId: correlation.sendOperationId,
          transportAttemptId: correlation.transportAttemptId,
          outboundRevisionId: correlation.outboundRevisionId,
          outboundRevisionRecipientId: correlation.outboundRevisionRecipientId,
          eventType: deliveryChild.deliveryEventType,
          eventDedupeKey,
          providerEventId: providerEvent.providerEventId,
          providerOccurredAt: deliveryChild.providerOccurredAt,
          receivedAt: providerEvent.receivedAt,
          smtpStatusCode: deliveryChild.smtpStatusCode,
          smtpEnhancedStatusCode: deliveryChild.smtpEnhancedStatusCode,
          diagnosticMessage: deliveryChild.diagnosticMessage,
        },
        auditMetadata: {
          ingestionEventId: input.ingestionEventId,
          deliveryEventId,
          sendOperationId: correlation.sendOperationId,
          transportAttemptId: correlation.transportAttemptId,
          revisionId: correlation.outboundRevisionId,
          revisionRecipientId: correlation.outboundRevisionRecipientId,
          eventType: deliveryChild.deliveryEventType,
          provider: providerEvent.provider,
        },
      });

      const deliveryEvent = await findDeliveryEventById(db, deliveryEventId);
      if (!deliveryEvent) {
        throw MailServiceError.conflict("Delivery event missing after batch");
      }

      return {
        materialization,
        deliveryEvent,
        convergedExistingDeliveryEvent,
      };
    } catch (batchError) {
      if (isUniqueConstraintError(batchError)) {
        const racedMaterialization = await findExistingMaterialization(
          db,
          input.ingestionEventId,
        );
        if (racedMaterialization) {
          return buildResultFromMaterialization(
            db,
            racedMaterialization,
            convergedExistingDeliveryEvent,
          );
        }
      }
      throw batchError;
    }
  } catch (error) {
    if (error instanceof DeliveryCorrelationPendingError) {
      await releaseDeliveryPending(db, {
        ingestionEventId: input.ingestionEventId,
        processingVersion,
      });
      throw error;
    }

    if (isOperationalInfrastructureError(error)) {
      await releaseDeliveryPending(db, {
        ingestionEventId: input.ingestionEventId,
        processingVersion,
      });
      throw error;
    }

    if (
      error instanceof MailServiceError &&
      error.errorCode === MAIL_ERROR_CODES.STALE_VERSION
    ) {
      throw error;
    }

    if (
      error instanceof MailServiceError &&
      error.errorCode === MAIL_ERROR_CODES.INTEGRITY_CONFLICT
    ) {
      const reason =
        error.message.includes("dedupe collision") ||
        error.message.includes("dedupe key")
          ? DELIVERY_QUARANTINE_REASONS.dedupeIntegrityConflict
          : correlationFailureToQuarantineReason("recipient_not_on_revision") ===
              error.message
            ? DELIVERY_QUARANTINE_REASONS.integrityConflict
            : DELIVERY_QUARANTINE_REASONS.integrityConflict;
      await quarantineDeliveryIngestion(db, {
        ingestionEventId: input.ingestionEventId,
        processingVersion,
        quarantineReason: reason,
        errorMessage: error.message,
      });
    } else if (!(error instanceof MailServiceError)) {
      await releaseDeliveryPending(db, {
        ingestionEventId: input.ingestionEventId,
        processingVersion,
      });
    }

    throw error;
  }
}

/** Test-only helper to exercise guarded delivery batch rollback semantics. */
export async function attemptInvalidDeliveryMaterializationBatch(
  db: Database,
  ingestionEventId: string,
): Promise<void> {
  const providerEvent = await findProviderEvent(db, ingestionEventId);
  const deliveryChild = await findDeliveryChild(db, ingestionEventId);
  if (!providerEvent || !deliveryChild) {
    throw MailServiceError.notFound("Delivery ingestion not found");
  }
  if (providerEvent.status !== "processing") {
    throw MailServiceError.validation(
      "Provider ingestion must be processing for invalid batch test",
    );
  }

  const correlation = await resolveMaterializationCorrelation(
    db,
    providerEvent,
    deliveryChild,
  );

  const deliveryEventId = crypto.randomUUID();
  const eventDedupeKey = providerEvent.ingestionDedupeKey;
  const completedProcessingVersion = providerEvent.processingVersion + 1;
  const guard: DeliveryMaterializationPostStateGuard = {
    ingestionEventId,
    completedProcessingVersion,
  };

  await runMailBatch(db, [
    db.insert(schema.mailDeliveryEvents).values({
      id: deliveryEventId,
      sendOperationId: correlation.sendOperationId,
      transportAttemptId: correlation.transportAttemptId,
      outboundRevisionId: correlation.outboundRevisionId,
      outboundRevisionRecipientId: correlation.outboundRevisionRecipientId,
      eventType: deliveryChild.deliveryEventType,
      eventDedupeKey,
      providerEventId: providerEvent.providerEventId,
      providerOccurredAt: deliveryChild.providerOccurredAt,
      receivedAt: providerEvent.receivedAt,
      smtpStatusCode: deliveryChild.smtpStatusCode,
      smtpEnhancedStatusCode: deliveryChild.smtpEnhancedStatusCode,
      diagnosticMessage: deliveryChild.diagnosticMessage,
    }),
    buildInboundProviderCompletedCasUpdate(db, guard, {
      processingProcessingVersion: providerEvent.processingVersion,
      finalizedAt: new Date().toISOString(),
    }),
    buildDeliveryMaterializationGuardedInsert(db, guard, {
      id: crypto.randomUUID(),
      deliveryEventId: "__invalid_delivery_event_guard__",
      eventDedupeKey,
      deliveryEventType: deliveryChild.deliveryEventType,
      materializedAt: new Date().toISOString(),
    }),
  ]);
}

export const deliveryEventMaterializationTestHooks =
  process.env.NODE_ENV === "test"
    ? {
        attemptInvalidDeliveryMaterializationBatch,
        deliveryEventSemanticGraphsEqual,
      }
    : undefined;
