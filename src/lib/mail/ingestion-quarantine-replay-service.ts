import { and, eq } from "drizzle-orm";
import type { MailDeliveryIngestionEvent } from "../../../drizzle/schema/mail-delivery-ingestion-events";
import type { MailInboundIngestionEvent } from "../../../drizzle/schema/mail-inbound-ingestion-events";
import type { MailProviderIngestionEvent } from "../../../drizzle/schema/mail-provider-ingestion-events";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import {
  correlateDeliveryRecipient,
  type ResolvedDeliveryCorrelation,
} from "@/lib/mail/delivery-recipient-correlation";
import {
  classifyDeliveryQuarantineReason,
  classifyInboundQuarantineReason,
  inboundReplayPreservesFrozenSnapshot,
  inboundReplayRequiresLiveRouteResolution,
  isDeliveryQuarantineReasonReplayable,
  isInboundQuarantineReasonReplayable,
} from "@/lib/mail/quarantine-replay-policy";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertBatchUpdateChanged,
  buildIngestionQuarantineReplayAuditInsert,
  buildProviderQuarantineReplayUpdate,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import { resolveInboundRouteForEnvelope } from "@/lib/mail/inbound-route-resolution";
import { assertMailDeliveryHealth } from "@/lib/permissions/mail";

export type QuarantineReplayOutcome =
  | "REPLAYED"
  | "REPLAY_NOT_READY"
  | "REPLAY_REFUSED";

export type QuarantineReplayResult = {
  outcome: QuarantineReplayOutcome;
  ingestionEventId: string;
  eventKind: MailProviderIngestionEvent["eventKind"];
  status: MailProviderIngestionEvent["status"];
  processingVersion: number;
  previousQuarantineReason: string | null;
  routeMode?: "direct" | "fallback" | null;
  frozenFallbackMailboxId?: string | null;
  message?: string;
};

export type QuarantinedIngestionListItem = {
  ingestionEventId: string;
  eventKind: MailProviderIngestionEvent["eventKind"];
  provider: string;
  status: MailProviderIngestionEvent["status"];
  quarantineReason: string | null;
  processingVersion: number;
  receivedAt: string;
  finalizedAt: string | null;
  replayable: boolean;
  replayClassification: string;
};

/**
 * Post-0065: durable processing lease enables safe stale detection.
 * Legacy unleased processing rows remain non-recoverable without controlled ops.
 */
export const STUCK_PROCESSING_RECOVERY_SCHEMA_GAP = {
  safeStaleProcessingDetectionRepresentable: true,
  stuckProcessingRecoveryImplemented: true,
  requiresSchemaEvolution: false,
  minimumConceptualRequirement: null,
} as const;

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

async function findInboundChild(
  db: Database,
  ingestionEventId: string,
): Promise<MailInboundIngestionEvent | null> {
  const [row] = await db
    .select()
    .from(schema.mailInboundIngestionEvents)
    .where(eq(schema.mailInboundIngestionEvents.ingestionEventId, ingestionEventId))
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

async function assertNoCanonicalMaterialization(
  db: Database,
  providerEvent: MailProviderIngestionEvent,
): Promise<void> {
  if (providerEvent.eventKind === "inbound_message") {
    const [row] = await db
      .select()
      .from(schema.mailInboundMessageMaterializations)
      .where(
        eq(schema.mailInboundMessageMaterializations.ingestionEventId, providerEvent.id),
      )
      .limit(1);
    if (row) {
      throw MailServiceError.conflict(
        "Completed inbound materialization exists; replay forbidden",
      );
    }
    return;
  }

  const [row] = await db
    .select()
    .from(schema.mailDeliveryEventMaterializations)
    .where(
      eq(schema.mailDeliveryEventMaterializations.ingestionEventId, providerEvent.id),
    )
    .limit(1);
  if (row) {
    throw MailServiceError.conflict(
      "Completed delivery materialization exists; replay forbidden",
    );
  }
}

async function assertMailboxOperational(
  db: Database,
  mailboxId: string,
): Promise<boolean> {
  const [mailbox] = await db
    .select()
    .from(schema.mailMailboxes)
    .where(eq(schema.mailMailboxes.id, mailboxId))
    .limit(1);
  return Boolean(mailbox && mailbox.status === "active");
}

function resolveInboundMaterializationMailboxId(
  inboundChild: MailInboundIngestionEvent,
): string | null {
  if (inboundChild.resolvedRouteMode === "direct") {
    return inboundChild.routeOwnerMailboxId;
  }
  if (inboundChild.resolvedRouteMode === "fallback") {
    return inboundChild.resolvedFallbackMailboxId;
  }
  return null;
}

async function evaluateInboundReplayReadiness(
  db: Database,
  providerEvent: MailProviderIngestionEvent,
  inboundChild: MailInboundIngestionEvent,
): Promise<
  | { ready: true; inboundChildUpdate?: Partial<MailInboundIngestionEvent> }
  | { ready: false; message: string }
> {
  const quarantineReason = providerEvent.quarantineReason;

  if (inboundReplayRequiresLiveRouteResolution(inboundChild, quarantineReason)) {
    const route = await resolveInboundRouteForEnvelope(
      db,
      inboundChild.envelopeRecipientAddress,
    );
    if (route.routeDecision === "quarantine") {
      return {
        ready: false,
        message: route.quarantineReason ?? "Route still quarantined",
      };
    }

    const now = new Date().toISOString();
    const provenanceResolved =
      route.receivingAddressId &&
      route.routeOwnerMailboxId &&
      route.routedAddressSnapshot;

    return {
      ready: true,
      inboundChildUpdate: {
        receivingAddressId: provenanceResolved ? route.receivingAddressId : null,
        routeOwnerMailboxId: provenanceResolved ? route.routeOwnerMailboxId : null,
        routedAddressSnapshot: provenanceResolved
          ? route.routedAddressSnapshot
          : null,
        routedAt: provenanceResolved ? now : null,
        resolvedRouteMode: route.resolvedRouteMode,
        resolvedFallbackMailboxId: route.resolvedFallbackMailboxId,
      },
    };
  }

  if (inboundReplayPreservesFrozenSnapshot(inboundChild)) {
    const mailboxId = resolveInboundMaterializationMailboxId(inboundChild);
    if (!mailboxId) {
      return { ready: false, message: "Frozen route snapshot incomplete" };
    }
    const operational = await assertMailboxOperational(db, mailboxId);
    if (!operational) {
      return {
        ready: false,
        message: "Frozen materialization target still non-operational",
      };
    }
    return { ready: true };
  }

  return { ready: false, message: "Inbound replay preconditions not satisfied" };
}

async function evaluateDeliveryReplayReadiness(
  db: Database,
  providerEvent: MailProviderIngestionEvent,
  deliveryChild: MailDeliveryIngestionEvent,
): Promise<
  | {
      ready: true;
      deliveryChildUpdate?: Partial<MailDeliveryIngestionEvent>;
    }
  | { ready: false; message: string }
> {
  if (
    deliveryChild.correlatedAt &&
    deliveryChild.sendOperationId &&
    deliveryChild.transportAttemptId &&
    deliveryChild.outboundRevisionId &&
    deliveryChild.outboundRevisionRecipientId
  ) {
    return { ready: true };
  }

  const correlationResult = await correlateDeliveryRecipient(db, {
    provider: providerEvent.provider,
    providerMessageId: providerEvent.providerMessageId,
    recipientAddress: deliveryChild.recipientAddress,
  });

  if (correlationResult.status === "resolved") {
    return {
      ready: true,
      deliveryChildUpdate: buildDeliveryChildCorrelationPatch(
        correlationResult.correlation,
      ),
    };
  }

  if (correlationResult.status === "unresolved") {
    return {
      ready: false,
      message: correlationResult.reason,
    };
  }

  return {
    ready: false,
    message: correlationResult.reason,
  };
}

function buildDeliveryChildCorrelationPatch(
  correlation: ResolvedDeliveryCorrelation,
): Partial<MailDeliveryIngestionEvent> {
  return {
    sendOperationId: correlation.sendOperationId,
    transportAttemptId: correlation.transportAttemptId,
    outboundRevisionId: correlation.outboundRevisionId,
    outboundRevisionRecipientId: correlation.outboundRevisionRecipientId,
    correlatedAt: correlation.correlatedAt,
  };
}

async function commitReplayTransition(
  db: Database,
  actor: MailActorContext,
  input: {
    providerEvent: MailProviderIngestionEvent;
    expectedProcessingVersion: number;
    previousQuarantineReason: string | null;
    inboundChildUpdate?: Partial<MailInboundIngestionEvent>;
    deliveryChildUpdate?: Partial<MailDeliveryIngestionEvent>;
    routeMode?: "direct" | "fallback" | null;
    frozenFallbackMailboxId?: string | null;
  },
): Promise<QuarantineReplayResult> {
  const nextProcessingVersion = input.expectedProcessingVersion + 1;
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const statements = [];

  if (input.inboundChildUpdate) {
    statements.push(
      db
        .update(schema.mailInboundIngestionEvents)
        .set(input.inboundChildUpdate)
        .where(
          eq(
            schema.mailInboundIngestionEvents.ingestionEventId,
            input.providerEvent.id,
          ),
        ),
    );
  }

  if (input.deliveryChildUpdate) {
    statements.push(
      db
        .update(schema.mailDeliveryIngestionEvents)
        .set(input.deliveryChildUpdate)
        .where(
          eq(
            schema.mailDeliveryIngestionEvents.ingestionEventId,
            input.providerEvent.id,
          ),
        ),
    );
  }

  statements.push(
    buildProviderQuarantineReplayUpdate(db, {
      ingestionEventId: input.providerEvent.id,
      expectedProcessingVersion: input.expectedProcessingVersion,
      nextProcessingVersion,
    }),
    buildIngestionQuarantineReplayAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.ingestionQuarantineReplayed,
      ingestionEventId: input.providerEvent.id,
      nextProcessingVersion,
      metadata: {
        ingestionEventId: input.providerEvent.id,
        ingestionKind: input.providerEvent.eventKind,
        previousQuarantineReason: input.previousQuarantineReason,
        newProcessingVersion: nextProcessingVersion,
        routeMode: input.routeMode ?? null,
        frozenFallbackMailboxId: input.frozenFallbackMailboxId ?? null,
      },
    }),
  );

  const replayUpdateIndex = statements.length - 2;
  const results = await runMailBatch(db, statements);
  assertBatchUpdateChanged(
    results,
    replayUpdateIndex,
    "Quarantine replay CAS transition failed",
  );

  return {
    outcome: "REPLAYED",
    ingestionEventId: input.providerEvent.id,
    eventKind: input.providerEvent.eventKind,
    status: "pending",
    processingVersion: nextProcessingVersion,
    previousQuarantineReason: input.previousQuarantineReason,
    routeMode: input.routeMode ?? null,
    frozenFallbackMailboxId: input.frozenFallbackMailboxId ?? null,
  };
}

/**
 * List quarantined provider ingestion events (safe metadata only).
 */
export async function listQuarantinedIngestionEvents(
  db: Database,
  actor: MailActorContext,
  input?: { eventKind?: MailProviderIngestionEvent["eventKind"] },
): Promise<QuarantinedIngestionListItem[]> {
  assertMailDeliveryHealth(actor);

  const rows = await db
    .select()
    .from(schema.mailProviderIngestionEvents)
    .where(
      input?.eventKind
        ? and(
            eq(schema.mailProviderIngestionEvents.status, "quarantined"),
            eq(schema.mailProviderIngestionEvents.eventKind, input.eventKind),
          )
        : eq(schema.mailProviderIngestionEvents.status, "quarantined"),
    );

  return rows.map((row) => {
    const classification =
      row.eventKind === "inbound_message"
        ? classifyInboundQuarantineReason(row.quarantineReason)
        : classifyDeliveryQuarantineReason(row.quarantineReason);
    const replayable =
      row.eventKind === "inbound_message"
        ? isInboundQuarantineReasonReplayable(row.quarantineReason)
        : isDeliveryQuarantineReasonReplayable(row.quarantineReason);

    return {
      ingestionEventId: row.id,
      eventKind: row.eventKind,
      provider: row.provider,
      status: row.status,
      quarantineReason: row.quarantineReason,
      processingVersion: row.processingVersion,
      receivedAt: row.receivedAt,
      finalizedAt: row.finalizedAt,
      replayable,
      replayClassification: classification,
    };
  });
}

/**
 * Replay a quarantined provider ingestion event back to pending (Phase 2C.12A).
 */
export async function replayQuarantinedIngestionEvent(
  db: Database,
  actor: MailActorContext,
  input: {
    ingestionEventId: string;
    expectedProcessingVersion?: number;
  },
): Promise<QuarantineReplayResult> {
  assertMailDeliveryHealth(actor);

  const providerEvent = await findProviderEvent(db, input.ingestionEventId);
  if (!providerEvent) {
    throw MailServiceError.notFound("Provider ingestion event not found");
  }

  if (providerEvent.status === "completed") {
    throw MailServiceError.validation("Completed ingestion cannot be replayed");
  }

  if (providerEvent.status !== "quarantined") {
    throw MailServiceError.validation(
      "Only quarantined ingestion events may be replayed",
      { status: providerEvent.status },
    );
  }

  await assertNoCanonicalMaterialization(db, providerEvent);

  const previousQuarantineReason = providerEvent.quarantineReason;
  const replayable =
    providerEvent.eventKind === "inbound_message"
      ? isInboundQuarantineReasonReplayable(previousQuarantineReason)
      : isDeliveryQuarantineReasonReplayable(previousQuarantineReason);

  if (!replayable) {
    return {
      outcome: "REPLAY_REFUSED",
      ingestionEventId: providerEvent.id,
      eventKind: providerEvent.eventKind,
      status: providerEvent.status,
      processingVersion: providerEvent.processingVersion,
      previousQuarantineReason,
      message: "Quarantine reason is not replayable",
    };
  }

  const expectedProcessingVersion =
    input.expectedProcessingVersion ?? providerEvent.processingVersion;
  if (providerEvent.processingVersion !== expectedProcessingVersion) {
    throw MailServiceError.staleVersion(
      "Quarantine replay processing version mismatch",
    );
  }

  if (providerEvent.eventKind === "inbound_message") {
    const inboundChild = await findInboundChild(db, providerEvent.id);
    if (!inboundChild) {
      throw MailServiceError.integrityConflict("Inbound ingestion child missing");
    }

    const readiness = await evaluateInboundReplayReadiness(
      db,
      providerEvent,
      inboundChild,
    );
    if (!readiness.ready) {
      return {
        outcome: "REPLAY_NOT_READY",
        ingestionEventId: providerEvent.id,
        eventKind: providerEvent.eventKind,
        status: providerEvent.status,
        processingVersion: providerEvent.processingVersion,
        previousQuarantineReason,
        message: readiness.message,
      };
    }

    const routeMode =
      readiness.inboundChildUpdate?.resolvedRouteMode ??
      inboundChild.resolvedRouteMode;
    const frozenFallbackMailboxId =
      readiness.inboundChildUpdate?.resolvedFallbackMailboxId ??
      inboundChild.resolvedFallbackMailboxId;

    return commitReplayTransition(db, actor, {
      providerEvent,
      expectedProcessingVersion,
      previousQuarantineReason,
      inboundChildUpdate: readiness.inboundChildUpdate,
      routeMode: routeMode as "direct" | "fallback" | null,
      frozenFallbackMailboxId,
    });
  }

  const deliveryChild = await findDeliveryChild(db, providerEvent.id);
  if (!deliveryChild) {
    throw MailServiceError.integrityConflict("Delivery ingestion child missing");
  }

  const readiness = await evaluateDeliveryReplayReadiness(
    db,
    providerEvent,
    deliveryChild,
  );
  if (!readiness.ready) {
    return {
      outcome: "REPLAY_NOT_READY",
      ingestionEventId: providerEvent.id,
      eventKind: providerEvent.eventKind,
      status: providerEvent.status,
      processingVersion: providerEvent.processingVersion,
      previousQuarantineReason,
      message: readiness.message,
    };
  }

  return commitReplayTransition(db, actor, {
    providerEvent,
    expectedProcessingVersion,
    previousQuarantineReason,
    deliveryChildUpdate: readiness.deliveryChildUpdate,
  });
}
