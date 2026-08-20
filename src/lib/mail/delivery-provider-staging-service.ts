import { eq, sql } from "drizzle-orm";
import type { MailDeliveryEventType } from "../../../drizzle/schema/mail-delivery-events";
import type { MailDeliveryIngestionEvent } from "../../../drizzle/schema/mail-delivery-ingestion-events";
import type { MailProviderIngestionEvent } from "../../../drizzle/schema/mail-provider-ingestion-events";
import type { MailProviderIngestionStatus } from "../../../drizzle/schema/mail-provider-ingestion-events";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import {
  MAIL_AUDIT_ACTIONS,
  MAIL_ERROR_CODES,
} from "@/lib/mail/constants";
import { buildDeliveryIngestionDedupeKey } from "@/lib/mail/delivery-ingestion-dedupe-key";
import {
  correlationFailureToQuarantineReason,
  correlateDeliveryRecipient,
  isDeterministicCorrelationFailure,
  type ResolvedDeliveryCorrelation,
} from "@/lib/mail/delivery-recipient-correlation";
import { DELIVERY_QUARANTINE_REASONS } from "@/lib/mail/delivery-quarantine-reasons";
import { runMailBatch } from "@/lib/mail/guarded-batch";
import { MailServiceError } from "@/lib/mail/errors";
import {
  computeInboundPayloadContentHash,
  toPayloadByteArray,
} from "@/lib/mail/inbound-payload-hash";
import type { InboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import { INBOUND_RAW_PAYLOAD_STORAGE_PROVIDER } from "@/lib/mail/inbound-raw-payload-store";
import { isUniqueConstraintError } from "@/lib/mail/mailbox-service";
import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";

export type StageDeliveryProviderEventInput = {
  provider: string;
  providerEventId: string;
  providerRequestId?: string | null;
  providerMessageId?: string | null;
  recipientAddress: string;
  deliveryEventType: MailDeliveryEventType;
  providerOccurredAt?: string | null;
  smtpStatusCode?: string | null;
  smtpEnhancedStatusCode?: string | null;
  diagnosticMessage?: string | null;
  receivedAt: string;
  rawPayloadBytes?: Uint8Array | ArrayBuffer | Buffer | null;
};

export type StagedDeliveryProviderEventResult = {
  ingestionEventId: string;
  deliveryIngestionEventId: string;
  providerStatus: MailProviderIngestionStatus;
  quarantineReason: string | null;
  correlation: ResolvedDeliveryCorrelation | null;
  eventDedupeKey: string;
  durablyStaged: boolean;
  safeToAcknowledgeProvider: boolean;
  idempotentReplay: boolean;
};

type SharedPayloadRef = {
  storageProvider: typeof INBOUND_RAW_PAYLOAD_STORAGE_PROVIDER;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
} | null;

async function findProviderEventByDedupeKey(
  db: Database,
  dedupeKey: string,
): Promise<MailProviderIngestionEvent | null> {
  const [row] = await db
    .select()
    .from(schema.mailProviderIngestionEvents)
    .where(eq(schema.mailProviderIngestionEvents.ingestionDedupeKey, dedupeKey))
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

function verifyIdempotentDeliveryProviderEvent(
  existing: MailProviderIngestionEvent,
  deliveryChild: MailDeliveryIngestionEvent | null,
  input: {
    provider: string;
    providerEventId: string;
    providerMessageId?: string | null;
    recipientAddress: string;
    deliveryEventType: MailDeliveryEventType;
    payloadContentHash: string | null;
    payloadSizeBytes: number | null;
  },
): void {
  if (existing.eventKind !== "delivery_event") {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe key collision with non-delivery event",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if (existing.provider.trim() !== input.provider.trim()) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched provider identity",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if ((existing.providerEventId ?? null) !== input.providerEventId) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched provider event id",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if (
    (existing.providerMessageId ?? null) !== (input.providerMessageId?.trim() || null)
  ) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched provider message id",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if (
    existing.payloadContentHash &&
    input.payloadContentHash &&
    existing.payloadContentHash !== input.payloadContentHash
  ) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched payload hash",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if (
    existing.payloadSizeBytes != null &&
    input.payloadSizeBytes != null &&
    existing.payloadSizeBytes !== input.payloadSizeBytes
  ) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched payload size",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if (!deliveryChild) {
    throw MailServiceError.integrityConflict(
      "Delivery ingestion child missing for existing provider event",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if (deliveryChild.recipientAddress !== input.recipientAddress) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched recipient address",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if (deliveryChild.deliveryEventType !== input.deliveryEventType) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched delivery event type",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }
}

function buildResultFromExisting(
  existing: MailProviderIngestionEvent,
  deliveryChild: MailDeliveryIngestionEvent,
): StagedDeliveryProviderEventResult {
  const correlation =
    deliveryChild.correlatedAt &&
    deliveryChild.sendOperationId &&
    deliveryChild.transportAttemptId &&
    deliveryChild.outboundRevisionId &&
    deliveryChild.outboundRevisionRecipientId
      ? {
          sendOperationId: deliveryChild.sendOperationId,
          transportAttemptId: deliveryChild.transportAttemptId,
          outboundRevisionId: deliveryChild.outboundRevisionId,
          outboundRevisionRecipientId: deliveryChild.outboundRevisionRecipientId,
          normalizedRecipientAddress: deliveryChild.recipientAddress,
          correlatedAt: deliveryChild.correlatedAt,
        }
      : null;

  return {
    ingestionEventId: existing.id,
    deliveryIngestionEventId: deliveryChild.id,
    providerStatus: existing.status,
    quarantineReason: existing.quarantineReason,
    correlation,
    eventDedupeKey: existing.ingestionDedupeKey,
    durablyStaged: true,
    safeToAcknowledgeProvider:
      existing.status !== "quarantined" &&
      Boolean(existing.payloadStorageKey || !existing.payloadContentHash),
    idempotentReplay: true,
  };
}

async function persistStagedDeliveryEvent(
  db: Database,
  input: {
    provider: string;
    providerEventId: string;
    providerRequestId?: string | null;
    providerMessageId?: string | null;
    recipientAddress: string;
    deliveryEventType: MailDeliveryEventType;
    providerOccurredAt?: string | null;
    smtpStatusCode?: string | null;
    smtpEnhancedStatusCode?: string | null;
    diagnosticMessage?: string | null;
    receivedAt: string;
    dedupeKey: string;
    sharedPayload: SharedPayloadRef;
    correlation: ResolvedDeliveryCorrelation | null;
    quarantineReason: string | null;
  },
): Promise<StagedDeliveryProviderEventResult> {
  const ingestionEventId = crypto.randomUUID();
  const deliveryIngestionEventId = crypto.randomUUID();
  const now = input.receivedAt;
  const quarantined = input.quarantineReason !== null;
  const providerStatus: MailProviderIngestionStatus = quarantined
    ? "quarantined"
    : "pending";

  const correlationResolved = input.correlation !== null;

  await runMailBatch(db, [
    db.insert(schema.mailProviderIngestionEvents).values({
      id: ingestionEventId,
      eventKind: "delivery_event",
      provider: input.provider.trim(),
      ingestionDedupeKey: input.dedupeKey,
      providerEventId: input.providerEventId,
      providerRequestId: input.providerRequestId?.trim() ?? null,
      providerMessageId: input.providerMessageId?.trim() || null,
      status: providerStatus,
      processingVersion: 1,
      finalizedAt: quarantined ? now : null,
      quarantineReason: input.quarantineReason,
      errorCode: quarantined ? MAIL_ERROR_CODES.INTEGRITY_CONFLICT : null,
      receivedAt: input.receivedAt,
      payloadStorageProvider: input.sharedPayload?.storageProvider ?? null,
      payloadStorageKey: input.sharedPayload?.storageKey ?? null,
      payloadContentHash: input.sharedPayload?.contentHash ?? null,
      payloadSizeBytes: input.sharedPayload?.sizeBytes ?? null,
    }),
    db.insert(schema.mailDeliveryIngestionEvents).values({
      id: deliveryIngestionEventId,
      ingestionEventId,
      eventKind: "delivery_event",
      recipientAddress: input.recipientAddress,
      deliveryEventType: input.deliveryEventType,
      providerOccurredAt: input.providerOccurredAt ?? null,
      smtpStatusCode: input.smtpStatusCode ?? null,
      smtpEnhancedStatusCode: input.smtpEnhancedStatusCode ?? null,
      diagnosticMessage: input.diagnosticMessage ?? null,
      sendOperationId: correlationResolved ? input.correlation!.sendOperationId : null,
      transportAttemptId: correlationResolved
        ? input.correlation!.transportAttemptId
        : null,
      outboundRevisionId: correlationResolved
        ? input.correlation!.outboundRevisionId
        : null,
      outboundRevisionRecipientId: correlationResolved
        ? input.correlation!.outboundRevisionRecipientId
        : null,
      correlatedAt: correlationResolved ? input.correlation!.correlatedAt : null,
    }),
    buildStagingAuditInsert(db, {
      auditId: crypto.randomUUID(),
      now,
      ingestionEventId,
      deliveryEventType: input.deliveryEventType,
      providerStatus,
      correlationResolved,
    }),
  ]);

  return {
    ingestionEventId,
    deliveryIngestionEventId,
    providerStatus,
    quarantineReason: input.quarantineReason,
    correlation: input.correlation,
    eventDedupeKey: input.dedupeKey,
    durablyStaged: true,
    safeToAcknowledgeProvider:
      !quarantined && (input.sharedPayload !== null || input.sharedPayload === null),
    idempotentReplay: false,
  };
}

function buildStagingAuditInsert(
  db: Database,
  input: {
    auditId: string;
    now: string;
    ingestionEventId: string;
    deliveryEventType: MailDeliveryEventType;
    providerStatus: MailProviderIngestionStatus;
    correlationResolved: boolean;
  },
) {
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${input.auditId} AS id,
        NULL AS user_id,
        ${MAIL_AUDIT_ACTIONS.deliveryProviderStaged} AS action,
        ${"mail_provider_ingestion_event"} AS entity_type,
        ${input.ingestionEventId} AS entity_id,
        NULL AS ip_address,
        NULL AS user_agent,
        ${JSON.stringify({
          ingestionEventId: input.ingestionEventId,
          deliveryEventType: input.deliveryEventType,
          providerStatus: input.providerStatus,
          correlationResolved: input.correlationResolved,
        })} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

/**
 * Provider-neutral durable delivery callback staging (Phase 2C.11).
 *
 * Ordering: optional raw payload store write MUST succeed before D1 ingestion rows.
 */
export async function stageDeliveryProviderEvent(
  db: Database,
  payloadStore: InboundRawPayloadStore | null,
  input: StageDeliveryProviderEventInput,
): Promise<StagedDeliveryProviderEventResult> {
  const providerEventId = input.providerEventId.trim();
  if (!providerEventId) {
    throw MailServiceError.validation("Provider event id is required");
  }

  const providerMessageId = input.providerMessageId?.trim() || null;

  const normalizedRecipient = normalizeMailEmailAddress(input.recipientAddress);
  const dedupeKey = buildDeliveryIngestionDedupeKey({
    provider: input.provider,
    providerEventId,
    recipientAddress: normalizedRecipient,
    deliveryEventType: input.deliveryEventType,
  });

  let payloadContentHash: string | null = null;
  let payloadSizeBytes: number | null = null;
  let sharedPayload: SharedPayloadRef = null;

  if (input.rawPayloadBytes) {
    const bytes = toPayloadByteArray(input.rawPayloadBytes);
    payloadContentHash = computeInboundPayloadContentHash(bytes);
    payloadSizeBytes = bytes.byteLength;
    if (!payloadStore) {
      throw MailServiceError.validation("Payload store required for raw delivery payload");
    }
    try {
      const stored = await payloadStore.put(bytes);
      sharedPayload = {
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        contentHash: payloadContentHash,
        sizeBytes: payloadSizeBytes,
      };
    } catch {
      return {
        ingestionEventId: "",
        deliveryIngestionEventId: "",
        providerStatus: "pending",
        quarantineReason: null,
        correlation: null,
        eventDedupeKey: dedupeKey,
        durablyStaged: false,
        safeToAcknowledgeProvider: false,
        idempotentReplay: false,
      };
    }
  }

  const existing = await findProviderEventByDedupeKey(db, dedupeKey);
  if (existing) {
    const deliveryChild = await findDeliveryChild(db, existing.id);
    verifyIdempotentDeliveryProviderEvent(existing, deliveryChild, {
      provider: input.provider,
      providerEventId,
      providerMessageId,
      recipientAddress: normalizedRecipient,
      deliveryEventType: input.deliveryEventType,
      payloadContentHash,
      payloadSizeBytes,
    });
    return buildResultFromExisting(existing, deliveryChild!);
  }

  const correlationResult = await correlateDeliveryRecipient(db, {
    provider: input.provider,
    providerMessageId,
    recipientAddress: normalizedRecipient,
    now: input.receivedAt,
  });

  let correlation: ResolvedDeliveryCorrelation | null = null;
  let quarantineReason: string | null = null;

  if (correlationResult.status === "resolved") {
    correlation = correlationResult.correlation;
  } else if (isDeterministicCorrelationFailure(correlationResult)) {
    quarantineReason = correlationFailureToQuarantineReason(correlationResult.reason);
  } else if (
    correlationResult.status === "unresolved" &&
    correlationResult.reason === "missing_provider_message_id"
  ) {
    quarantineReason = DELIVERY_QUARANTINE_REASONS.missingProviderMessageId;
  }

  try {
    return await persistStagedDeliveryEvent(db, {
      provider: input.provider,
      providerEventId,
      providerRequestId: input.providerRequestId,
      providerMessageId,
      recipientAddress: normalizedRecipient,
      deliveryEventType: input.deliveryEventType,
      providerOccurredAt: input.providerOccurredAt,
      smtpStatusCode: input.smtpStatusCode,
      smtpEnhancedStatusCode: input.smtpEnhancedStatusCode,
      diagnosticMessage: input.diagnosticMessage,
      receivedAt: input.receivedAt,
      dedupeKey,
      sharedPayload,
      correlation,
      quarantineReason,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await findProviderEventByDedupeKey(db, dedupeKey);
      if (raced) {
        const deliveryChild = await findDeliveryChild(db, raced.id);
        verifyIdempotentDeliveryProviderEvent(raced, deliveryChild, {
          provider: input.provider,
          providerEventId,
          providerMessageId,
          recipientAddress: normalizedRecipient,
          deliveryEventType: input.deliveryEventType,
          payloadContentHash,
          payloadSizeBytes,
        });
        return buildResultFromExisting(raced, deliveryChild!);
      }
    }
    throw error;
  }
}
