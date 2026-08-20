import { eq, sql } from "drizzle-orm";
import type { MailProviderIngestionEvent } from "../../../drizzle/schema/mail-provider-ingestion-events";
import type { MailProviderIngestionStatus } from "../../../drizzle/schema/mail-provider-ingestion-events";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import {
  MAIL_AUDIT_ACTIONS,
  MAIL_ERROR_CODES,
} from "@/lib/mail/constants";
import { buildInboundIngestionDedupeKey } from "@/lib/mail/inbound-ingestion-dedupe-key";
import {
  computeInboundPayloadContentHash,
  toPayloadByteArray,
} from "@/lib/mail/inbound-payload-hash";
import { INBOUND_QUARANTINE_REASONS } from "@/lib/mail/inbound-quarantine-reasons";
import type { InboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import { INBOUND_RAW_PAYLOAD_STORAGE_PROVIDER } from "@/lib/mail/inbound-raw-payload-store";
import {
  resolveInboundRouteForEnvelope,
  type ResolvedInboundRoute,
} from "@/lib/mail/inbound-route-resolution";
import type { InboundRoutingDecision } from "@/lib/mail/inbound-routing-policy";
import {
  frozenRouteSnapshotFromInboundChild,
  isInboundRouteSnapshotAckSafe,
  routeDecisionFromSnapshot,
} from "@/lib/mail/inbound-route-snapshot";
import { runMailBatch } from "@/lib/mail/guarded-batch";
import { MailServiceError } from "@/lib/mail/errors";
import { isUniqueConstraintError } from "@/lib/mail/mailbox-service";
import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";

export type StageInboundProviderEventInput = {
  provider: string;
  providerEventId?: string | null;
  providerRequestId?: string | null;
  providerMessageId?: string | null;
  receivedAt: string;
  rawPayloadBytes: Uint8Array | ArrayBuffer | Buffer;
  envelopeRecipients: string[];
};

export type StagedInboundEnvelopeResult = {
  envelopeRecipientAddress: string;
  ingestionEventId: string;
  inboundIngestionEventId: string;
  routeDecision: InboundRoutingDecision;
  providerStatus: MailProviderIngestionStatus;
  quarantineReason: string | null;
  receivingAddressId: string | null;
  routeOwnerMailboxId: string | null;
  routedAddressSnapshot: string | null;
  resolvedRouteMode: "direct" | "fallback" | null;
  resolvedFallbackMailboxId: string | null;
  durablyStaged: boolean;
  safeToAcknowledgeProvider: boolean;
  idempotentReplay: boolean;
};

export type StageInboundProviderEventResult = {
  durablyStaged: boolean;
  safeToAcknowledgeProvider: boolean;
  payloadContentHash: string;
  payloadSizeBytes: number;
  envelopeResults: StagedInboundEnvelopeResult[];
};

type SharedPayloadRef = {
  storageProvider: typeof INBOUND_RAW_PAYLOAD_STORAGE_PROVIDER;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
};

function normalizeEnvelopeRecipients(recipients: string[]): string[] {
  if (!recipients.length) {
    throw MailServiceError.validation("At least one envelope recipient is required");
  }
  const normalized = recipients.map((address) =>
    normalizeMailEmailAddress(address),
  );
  return [...new Set(normalized)];
}

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

function verifyIdempotentProviderEvent(
  existing: MailProviderIngestionEvent,
  input: {
    provider: string;
    providerEventId?: string | null;
    providerMessageId?: string | null;
    envelopeRecipient: string;
    payloadContentHash: string;
    payloadSizeBytes: number;
  },
): void {
  if (existing.eventKind !== "inbound_message") {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe key collision with non-inbound event",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if (existing.provider.trim() !== input.provider.trim()) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched provider identity",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  const existingEventId = existing.providerEventId?.trim() ?? null;
  const incomingEventId = input.providerEventId?.trim() ?? null;
  if (existingEventId !== incomingEventId) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched provider event id",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  const existingMessageId = existing.providerMessageId?.trim() ?? null;
  const incomingMessageId = input.providerMessageId?.trim() ?? null;
  if (existingMessageId !== incomingMessageId) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched provider message id",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if (
    existing.payloadContentHash &&
    existing.payloadContentHash !== input.payloadContentHash
  ) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched raw payload hash",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }

  if (
    existing.payloadSizeBytes != null &&
    existing.payloadSizeBytes !== input.payloadSizeBytes
  ) {
    throw MailServiceError.integrityConflict(
      "Ingestion dedupe collision with mismatched raw payload size",
      { dedupeKey: existing.ingestionDedupeKey },
    );
  }
}

async function loadInboundChildForProviderEvent(
  db: Database,
  ingestionEventId: string,
) {
  const [row] = await db
    .select()
    .from(schema.mailInboundIngestionEvents)
    .where(eq(schema.mailInboundIngestionEvents.ingestionEventId, ingestionEventId))
    .limit(1);
  return row ?? null;
}

function buildEnvelopeResultFromExisting(
  existing: MailProviderIngestionEvent,
  inboundChild: Awaited<ReturnType<typeof loadInboundChildForProviderEvent>>,
): StagedInboundEnvelopeResult {
  if (!inboundChild) {
    return {
      envelopeRecipientAddress: "",
      ingestionEventId: existing.id,
      inboundIngestionEventId: existing.id,
      routeDecision: "quarantine",
      providerStatus: existing.status,
      quarantineReason: existing.quarantineReason,
      receivingAddressId: null,
      routeOwnerMailboxId: null,
      routedAddressSnapshot: null,
      resolvedRouteMode: null,
      resolvedFallbackMailboxId: null,
      durablyStaged: false,
      safeToAcknowledgeProvider: false,
      idempotentReplay: true,
    };
  }

  const snapshot = frozenRouteSnapshotFromInboundChild(inboundChild);
  const routeDecision = routeDecisionFromSnapshot(snapshot, existing.status);

  return {
    envelopeRecipientAddress: inboundChild.envelopeRecipientAddress,
    ingestionEventId: existing.id,
    inboundIngestionEventId: inboundChild.id,
    routeDecision,
    providerStatus: existing.status,
    quarantineReason: existing.quarantineReason,
    receivingAddressId: snapshot.receivingAddressId,
    routeOwnerMailboxId: snapshot.routeOwnerMailboxId,
    routedAddressSnapshot: snapshot.routedAddressSnapshot,
    resolvedRouteMode: snapshot.resolvedRouteMode,
    resolvedFallbackMailboxId: snapshot.resolvedFallbackMailboxId,
    durablyStaged: Boolean(
      existing.payloadStorageKey &&
        existing.payloadContentHash &&
        existing.payloadSizeBytes != null,
    ),
    safeToAcknowledgeProvider: isInboundRouteSnapshotAckSafe({
      providerEvent: existing,
      inboundChild,
    }),
    idempotentReplay: true,
  };
}

function buildStagingAuditInsert(
  db: Database,
  input: {
    auditId: string;
    now: string;
    ingestionEventId: string;
    provider: string;
    routeDecision: InboundRoutingDecision;
    providerStatus: MailProviderIngestionStatus;
    payloadHashPrefix: string;
    envelopeRecipientCount: number;
    frozenFallbackMailboxId: string | null;
  },
) {
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${input.auditId} AS id,
        NULL AS user_id,
        ${MAIL_AUDIT_ACTIONS.inboundProviderStaged} AS action,
        ${"mail_provider_ingestion_event"} AS entity_type,
        ${input.ingestionEventId} AS entity_id,
        NULL AS ip_address,
        NULL AS user_agent,
        ${JSON.stringify({
          ingestionEventId: input.ingestionEventId,
          provider: input.provider,
          routeDecision: input.routeDecision,
          providerStatus: input.providerStatus,
          payloadHashPrefix: input.payloadHashPrefix,
          envelopeRecipientCount: input.envelopeRecipientCount,
          frozenFallbackMailboxId: input.frozenFallbackMailboxId,
        })} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

async function persistStagedEnvelope(
  db: Database,
  input: {
    provider: string;
    providerEventId?: string | null;
    providerRequestId?: string | null;
    providerMessageId?: string | null;
    receivedAt: string;
    dedupeKey: string;
    route: ResolvedInboundRoute;
    sharedPayload: SharedPayloadRef;
    envelopeRecipientCount: number;
  },
): Promise<StagedInboundEnvelopeResult> {
  const now = new Date().toISOString();
  const ingestionEventId = crypto.randomUUID();
  const inboundIngestionEventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  const quarantined = input.route.routeDecision === "quarantine";
  const providerStatus: MailProviderIngestionStatus = quarantined
    ? "quarantined"
    : "pending";

  const provenanceResolved =
    input.route.receivingAddressKnown &&
    input.route.receivingAddressId &&
    input.route.routeOwnerMailboxId &&
    input.route.routedAddressSnapshot;

  await runMailBatch(db, [
    db.insert(schema.mailProviderIngestionEvents).values({
      id: ingestionEventId,
      eventKind: "inbound_message",
      provider: input.provider.trim(),
      ingestionDedupeKey: input.dedupeKey,
      providerEventId: input.providerEventId?.trim() || null,
      providerRequestId: input.providerRequestId?.trim() || null,
      providerMessageId: input.providerMessageId?.trim() || null,
      status: providerStatus,
      processingVersion: 1,
      finalizedAt: quarantined ? now : null,
      quarantineReason: quarantined ? input.route.quarantineReason : null,
      errorCode: null,
      errorMessage: null,
      receivedAt: input.receivedAt,
      payloadStorageProvider: input.sharedPayload.storageProvider,
      payloadStorageKey: input.sharedPayload.storageKey,
      payloadContentHash: input.sharedPayload.contentHash,
      payloadSizeBytes: input.sharedPayload.sizeBytes,
    }),
    db.insert(schema.mailInboundIngestionEvents).values({
      id: inboundIngestionEventId,
      ingestionEventId,
      eventKind: "inbound_message",
      envelopeRecipientAddress: input.route.normalizedEnvelopeRecipient,
      receivingAddressId: provenanceResolved ? input.route.receivingAddressId : null,
      routeOwnerMailboxId: provenanceResolved
        ? input.route.routeOwnerMailboxId
        : null,
      routedAddressSnapshot: provenanceResolved
        ? input.route.routedAddressSnapshot
        : null,
      routedAt: provenanceResolved ? now : null,
      resolvedRouteMode: input.route.resolvedRouteMode,
      resolvedFallbackMailboxId: input.route.resolvedFallbackMailboxId,
    }),
    buildStagingAuditInsert(db, {
      auditId,
      now,
      ingestionEventId,
      provider: input.provider.trim(),
      routeDecision: input.route.routeDecision,
      providerStatus,
      payloadHashPrefix: input.sharedPayload.contentHash.slice(0, 12),
      envelopeRecipientCount: input.envelopeRecipientCount,
      frozenFallbackMailboxId: input.route.resolvedFallbackMailboxId,
    }),
  ]);

  const ackSafe = isInboundRouteSnapshotAckSafe({
    providerEvent: {
      status: providerStatus,
      payloadStorageKey: input.sharedPayload.storageKey,
      payloadContentHash: input.sharedPayload.contentHash,
      payloadSizeBytes: input.sharedPayload.sizeBytes,
    },
    inboundChild: {
      id: inboundIngestionEventId,
      ingestionEventId,
      eventKind: "inbound_message",
      envelopeRecipientAddress: input.route.normalizedEnvelopeRecipient,
      receivingAddressId: provenanceResolved ? input.route.receivingAddressId : null,
      routeOwnerMailboxId: provenanceResolved
        ? input.route.routeOwnerMailboxId
        : null,
      routedAddressSnapshot: provenanceResolved
        ? input.route.routedAddressSnapshot
        : null,
      routedAt: provenanceResolved ? now : null,
      resolvedRouteMode: input.route.resolvedRouteMode,
      resolvedFallbackMailboxId: input.route.resolvedFallbackMailboxId,
    },
  });

  return {
    envelopeRecipientAddress: input.route.normalizedEnvelopeRecipient,
    ingestionEventId,
    inboundIngestionEventId,
    routeDecision: input.route.routeDecision,
    providerStatus,
    quarantineReason: quarantined ? input.route.quarantineReason : null,
    receivingAddressId: provenanceResolved ? input.route.receivingAddressId : null,
    routeOwnerMailboxId: provenanceResolved ? input.route.routeOwnerMailboxId : null,
    routedAddressSnapshot: provenanceResolved
      ? input.route.routedAddressSnapshot
      : null,
    resolvedRouteMode: input.route.resolvedRouteMode,
    resolvedFallbackMailboxId: input.route.resolvedFallbackMailboxId,
    durablyStaged: true,
    safeToAcknowledgeProvider: ackSafe,
    idempotentReplay: false,
  };
}

async function stageSingleEnvelopeRecipient(
  db: Database,
  input: {
    provider: string;
    providerEventId?: string | null;
    providerRequestId?: string | null;
    providerMessageId?: string | null;
    receivedAt: string;
    envelopeRecipient: string;
    sharedPayload: SharedPayloadRef;
    envelopeRecipientCount: number;
  },
): Promise<StagedInboundEnvelopeResult> {
  const route = await resolveInboundRouteForEnvelope(db, input.envelopeRecipient);
  const dedupeKey = buildInboundIngestionDedupeKey({
    provider: input.provider,
    providerEventId: input.providerEventId,
    providerMessageId: input.providerMessageId,
    envelopeRecipientAddress: route.normalizedEnvelopeRecipient,
  });

  const existing = await findProviderEventByDedupeKey(db, dedupeKey);
  if (existing) {
    verifyIdempotentProviderEvent(existing, {
      provider: input.provider,
      providerEventId: input.providerEventId,
      providerMessageId: input.providerMessageId,
      envelopeRecipient: route.normalizedEnvelopeRecipient,
      payloadContentHash: input.sharedPayload.contentHash,
      payloadSizeBytes: input.sharedPayload.sizeBytes,
    });
    const inboundChild = await loadInboundChildForProviderEvent(db, existing.id);
    if (
      inboundChild &&
      inboundChild.envelopeRecipientAddress !== route.normalizedEnvelopeRecipient
    ) {
      throw MailServiceError.integrityConflict(
        "Ingestion dedupe collision with mismatched envelope recipient",
        { dedupeKey },
      );
    }
    return buildEnvelopeResultFromExisting(existing, inboundChild);
  }

  try {
    return await persistStagedEnvelope(db, {
      provider: input.provider,
      providerEventId: input.providerEventId,
      providerRequestId: input.providerRequestId,
      providerMessageId: input.providerMessageId,
      receivedAt: input.receivedAt,
      dedupeKey,
      route,
      sharedPayload: input.sharedPayload,
      envelopeRecipientCount: input.envelopeRecipientCount,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await findProviderEventByDedupeKey(db, dedupeKey);
      if (raced) {
        verifyIdempotentProviderEvent(raced, {
          provider: input.provider,
          providerEventId: input.providerEventId,
          providerMessageId: input.providerMessageId,
          envelopeRecipient: route.normalizedEnvelopeRecipient,
          payloadContentHash: input.sharedPayload.contentHash,
          payloadSizeBytes: input.sharedPayload.sizeBytes,
        });
        const inboundChild = await loadInboundChildForProviderEvent(db, raced.id);
        return buildEnvelopeResultFromExisting(raced, inboundChild);
      }
    }
    throw error;
  }
}

/**
 * Provider-neutral durable inbound staging + route resolution (Phase 2C.9C).
 *
 * Ordering: raw payload store write MUST succeed before any D1 ingestion rows.
 * One provider ingestion event per envelope recipient (0061 UNIQUE on ingestion_event_id).
 */
export async function stageInboundProviderEvent(
  db: Database,
  payloadStore: InboundRawPayloadStore,
  input: StageInboundProviderEventInput,
): Promise<StageInboundProviderEventResult> {
  const bytes = toPayloadByteArray(input.rawPayloadBytes);
  const payloadContentHash = computeInboundPayloadContentHash(bytes);
  const payloadSizeBytes = bytes.byteLength;
  const envelopeRecipients = normalizeEnvelopeRecipients(input.envelopeRecipients);

  let sharedPayload: SharedPayloadRef;
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
      durablyStaged: false,
      safeToAcknowledgeProvider: false,
      payloadContentHash,
      payloadSizeBytes,
      envelopeResults: [],
    };
  }

  const envelopeResults: StagedInboundEnvelopeResult[] = [];
  for (const envelopeRecipient of envelopeRecipients) {
    try {
      const result = await stageSingleEnvelopeRecipient(db, {
        provider: input.provider,
        providerEventId: input.providerEventId,
        providerRequestId: input.providerRequestId,
        providerMessageId: input.providerMessageId,
        receivedAt: input.receivedAt,
        envelopeRecipient,
        sharedPayload,
        envelopeRecipientCount: envelopeRecipients.length,
      });
      envelopeResults.push(result);
    } catch (error) {
      if (
        error instanceof MailServiceError &&
        error.errorCode === MAIL_ERROR_CODES.INTEGRITY_CONFLICT
      ) {
        envelopeResults.push({
          envelopeRecipientAddress: envelopeRecipient,
          ingestionEventId: "",
          inboundIngestionEventId: "",
          routeDecision: "quarantine",
          providerStatus: "quarantined",
          quarantineReason: INBOUND_QUARANTINE_REASONS.integrityConflict,
          receivingAddressId: null,
          routeOwnerMailboxId: null,
          routedAddressSnapshot: null,
          resolvedRouteMode: null,
          resolvedFallbackMailboxId: null,
          durablyStaged: true,
          safeToAcknowledgeProvider: false,
          idempotentReplay: false,
        });
        continue;
      }
      return {
        durablyStaged: false,
        safeToAcknowledgeProvider: false,
        payloadContentHash,
        payloadSizeBytes,
        envelopeResults,
      };
    }
  }

  const durablyStaged = envelopeResults.every((result) => result.durablyStaged);
  const safeToAcknowledgeProvider = envelopeResults.every(
    (result) => result.safeToAcknowledgeProvider,
  );

  return {
    durablyStaged,
    safeToAcknowledgeProvider,
    payloadContentHash,
    payloadSizeBytes,
    envelopeResults,
  };
}

/** Test hook — force D1 failure after raw payload write succeeds. */
export async function stageInboundProviderEventWithBatchFailure(
  db: Database,
  payloadStore: InboundRawPayloadStore,
  input: StageInboundProviderEventInput,
  failBatch: typeof runMailBatch,
): Promise<StageInboundProviderEventResult> {
  const bytes = toPayloadByteArray(input.rawPayloadBytes);
  const payloadContentHash = computeInboundPayloadContentHash(bytes);
  const payloadSizeBytes = bytes.byteLength;
  const envelopeRecipients = normalizeEnvelopeRecipients(input.envelopeRecipients);

  let sharedPayload: SharedPayloadRef;
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
      durablyStaged: false,
      safeToAcknowledgeProvider: false,
      payloadContentHash,
      payloadSizeBytes,
      envelopeResults: [],
    };
  }

  const route = await resolveInboundRouteForEnvelope(db, envelopeRecipients[0]!);
  const dedupeKey = buildInboundIngestionDedupeKey({
    provider: input.provider,
    providerEventId: input.providerEventId,
    providerMessageId: input.providerMessageId,
    envelopeRecipientAddress: route.normalizedEnvelopeRecipient,
  });

  const now = new Date().toISOString();
  const ingestionEventId = crypto.randomUUID();
  const inboundIngestionEventId = crypto.randomUUID();
  const quarantined = route.routeDecision === "quarantine";
  const provenanceResolved =
    route.receivingAddressKnown &&
    route.receivingAddressId &&
    route.routeOwnerMailboxId &&
    route.routedAddressSnapshot;

  try {
    await failBatch(db, [
      db.insert(schema.mailProviderIngestionEvents).values({
        id: ingestionEventId,
        eventKind: "inbound_message",
        provider: input.provider.trim(),
        ingestionDedupeKey: dedupeKey,
        providerEventId: input.providerEventId?.trim() || null,
        status: quarantined ? "quarantined" : "pending",
        processingVersion: 1,
        finalizedAt: quarantined ? now : null,
        quarantineReason: quarantined ? route.quarantineReason : null,
        receivedAt: input.receivedAt,
        payloadStorageProvider: sharedPayload.storageProvider,
        payloadStorageKey: sharedPayload.storageKey,
        payloadContentHash: sharedPayload.contentHash,
        payloadSizeBytes: sharedPayload.sizeBytes,
      }),
      db.insert(schema.mailInboundIngestionEvents).values({
        id: inboundIngestionEventId,
        ingestionEventId,
        eventKind: "inbound_message",
        envelopeRecipientAddress: route.normalizedEnvelopeRecipient,
        receivingAddressId: provenanceResolved ? route.receivingAddressId : null,
        routeOwnerMailboxId: provenanceResolved ? route.routeOwnerMailboxId : null,
        routedAddressSnapshot: provenanceResolved ? route.routedAddressSnapshot : null,
        routedAt: provenanceResolved ? now : null,
        resolvedRouteMode: route.resolvedRouteMode,
        resolvedFallbackMailboxId: route.resolvedFallbackMailboxId,
      }),
    ]);
  } catch {
    return {
      durablyStaged: false,
      safeToAcknowledgeProvider: false,
      payloadContentHash,
      payloadSizeBytes,
      envelopeResults: [],
    };
  }

  throw new Error("Expected batch failure hook to throw");
}
