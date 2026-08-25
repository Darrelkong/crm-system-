import { and, eq, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import type { MailActorContext } from "@/lib/mail/actor-context";
import type { MailOperationalActor } from "@/lib/mail/system-mail-actor";
import {
  resolveMailAuditIpAddress,
  resolveMailAuditUserAgent,
  resolveMailAuditUserId,
  withSystemAuditMetadata,
} from "@/lib/mail/system-mail-actor";
import type {
  MailOutboundApprovalStatus,
} from "../../../drizzle/schema/mail-outbound-approvals";
import type { MailOutboundApprovalEventType } from "../../../drizzle/schema/mail-outbound-approval-events";
import { MailServiceError } from "./errors";

type BatchStatement = Parameters<Database["batch"]>[0][number];

type BatchRunResult = {
  meta?: {
    changes?: number;
  };
};

/**
 * Runs a D1 batch. Throws on driver/constraint failure (atomic rollback).
 */
export async function runMailBatch(
  db: Database,
  statements: BatchStatement[],
): Promise<readonly BatchRunResult[]> {
  return (await db.batch(
    statements as unknown as Parameters<Database["batch"]>[0],
  )) as readonly BatchRunResult[];
}

/**
 * Expects a prior UPDATE in the batch to have changed exactly one row.
 * Use for guarded state transitions (status CAS).
 */
export function assertBatchUpdateChanged(
  results: readonly BatchRunResult[],
  index: number,
  message = "Expected state changed",
): void {
  const changes = results[index]?.meta?.changes ?? 0;
  if (changes !== 1) {
    throw MailServiceError.staleVersion(message);
  }
}

/**
 * Single-statement guarded UPDATE helper.
 */
export async function runGuardedUpdate(
  db: Database,
  statement: BatchStatement,
  message = "Expected state changed",
): Promise<void> {
  const [result] = await runMailBatch(db, [statement]);
  assertBatchUpdateChanged([result], 0, message);
}

type CoordinatedPostStateGuardInput = {
  mailboxId: string;
  primaryId: string;
  expectedMailboxStatus: string;
  expectedPrimaryStatus: string;
};

/**
 * Audit INSERT that only succeeds when mailbox + current-primary post-state exists.
 * Uses audit_logs.id NOT NULL: a failed guard yields NULL id → constraint failure →
 * batch rollback (D1-compatible; RAISE is not available outside triggers).
 */
export function buildCoordinatedMailboxPostStateAuditInsert(
  db: Database,
  actor: MailActorContext,
  guard: CoordinatedPostStateGuardInput,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    entityType: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);
  const postStateIdSql = buildCoordinatedPostStateIdSql(guard, input.auditId);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${postStateIdSql} AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${input.entityType} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}
function buildCoordinatedPostStateIdSql(
  guard: CoordinatedPostStateGuardInput,
  auditId: string,
): SQL {
  return sql`(
    SELECT ${auditId}
    FROM mail_mailboxes m
    INNER JOIN mail_receiving_addresses ra
      ON ra.mailbox_id = m.id
      AND ra.id = ${guard.primaryId}
      AND ra.address_type = 'primary'
      AND ra.status = ${guard.expectedPrimaryStatus}
    WHERE m.id = ${guard.mailboxId}
      AND m.status = ${guard.expectedMailboxStatus}
    LIMIT 1
  )`;
}

type DraftVersionGuardInput = {
  draftId: string;
  expectedAutosaveVersion: number;
};

/**
 * Rotation audit INSERT guarded by post-state: old retired, new current, mailbox aligned.
 */
export function buildPrimaryRotationPostStateAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    mailboxId: string;
    oldPrimaryId: string;
    newPrimaryId: string;
    newAddress: string;
    newPrimaryStatus: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_mailboxes m
          INNER JOIN mail_receiving_addresses new_primary
            ON new_primary.id = ${input.newPrimaryId}
            AND new_primary.mailbox_id = m.id
            AND new_primary.address_type = 'primary'
            AND new_primary.status = ${input.newPrimaryStatus}
            AND new_primary.address = ${input.newAddress}
          INNER JOIN mail_receiving_addresses old_primary
            ON old_primary.id = ${input.oldPrimaryId}
            AND old_primary.address_type = 'primary'
            AND old_primary.status = 'retired'
          WHERE m.id = ${input.mailboxId}
            AND m.address = ${input.newAddress}
          LIMIT 1
        ) AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_receiving_address"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}

/**
 * Audit INSERT guarded by exact Draft autosave_version + not discarded.
 * Failed guard → NULL id → NOT NULL constraint → batch rollback.
 */
export function buildDraftVersionGuardedAuditInsert(
  db: Database,
  actor: MailActorContext,
  guard: DraftVersionGuardInput,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    entityType: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_drafts d
          WHERE d.id = ${guard.draftId}
            AND d.autosave_version = ${guard.expectedAutosaveVersion}
            AND d.discarded_at IS NULL
          LIMIT 1
        ) AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${input.entityType} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}
export function isMailPostStateGuardError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /NOT NULL constraint failed|post-state guard failed/i.test(message);
}

export type ApprovalPostStateGuard = {
  approvalId: string;
  revisionChainId: string;
  workflowVersion: number;
  status: MailOutboundApprovalStatus;
  currentRevisionId: string;
  currentContentHash: string;
  currentHashVersion: number;
};

function buildApprovalPostStateIdSql(
  guard: ApprovalPostStateGuard,
  idValue: string,
): SQL {
  const approvedMatch =
    guard.status === "approved"
      ? sql`
          AND a.approved_revision_id = ${guard.currentRevisionId}
          AND a.approved_content_hash = ${guard.currentContentHash}
          AND a.approved_hash_version = ${guard.currentHashVersion}
        `
      : sql``;

  return sql`(
    SELECT ${idValue}
    FROM mail_outbound_approvals a
    WHERE a.id = ${guard.approvalId}
      AND a.revision_chain_id = ${guard.revisionChainId}
      AND a.workflow_version = ${guard.workflowVersion}
      AND a.status = ${guard.status}
      AND a.current_revision_id = ${guard.currentRevisionId}
      AND a.current_content_hash = ${guard.currentContentHash}
      AND a.current_hash_version = ${guard.currentHashVersion}
      ${approvedMatch}
    LIMIT 1
  )`;
}

/**
 * Guarded transition event INSERT — approval_id derived from exact POST-transition state.
 * NULL subquery → NOT NULL failure → batch rollback.
 */
export function buildApprovalTransitionGuardedEventInsert(
  db: Database,
  guard: ApprovalPostStateGuard,
  input: {
    eventId: string;
    eventType: MailOutboundApprovalEventType;
    revisionId: string;
    contentHash: string;
    hashVersion: number;
    actorUserId: string;
    note?: string | null;
    now: string;
  },
) {
  const approvalIdSql = buildApprovalPostStateIdSql(guard, guard.approvalId);

  return db.insert(schema.mailOutboundApprovalEvents).select(
    sql`
      SELECT
        ${input.eventId} AS id,
        ${approvalIdSql} AS approval_id,
        ${guard.revisionChainId} AS revision_chain_id,
        ${input.eventType} AS event_type,
        ${guard.workflowVersion} AS workflow_version,
        ${input.actorUserId} AS actor_user_id,
        ${input.revisionId} AS revision_id,
        ${input.contentHash} AS content_hash,
        ${input.hashVersion} AS hash_version,
        ${input.note ?? null} AS note,
        ${input.now} AS created_at
      FROM (SELECT 1) AS event_driver
    `,
  );
}

/**
 * Audit INSERT guarded by exact Approval post-transition state.
 */
export function buildApprovalPostStateGuardedAuditInsert(
  db: Database,
  actor: MailActorContext,
  guard: ApprovalPostStateGuard,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);
  const postStateIdSql = buildApprovalPostStateIdSql(guard, input.auditId);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${postStateIdSql} AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_outbound_approval"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}
export type SendPostStateGuard = {
  sendOperationId: string;
  outboundRevisionId: string;
  orchestrationVersion: number;
  status: "pending" | "processing" | "accepted" | "failed";
};

function buildSendPostStateIdSql(guard: SendPostStateGuard, idValue: string): SQL {
  return sql`(
    SELECT ${idValue}
    FROM mail_send_operations s
    WHERE s.id = ${guard.sendOperationId}
      AND s.outbound_revision_id = ${guard.outboundRevisionId}
      AND s.orchestration_version = ${guard.orchestrationVersion}
      AND s.status = ${guard.status}
    LIMIT 1
  )`;
}

export function buildSendPostStateGuardedAuditInsert(
  db: Database,
  actor: MailActorContext,
  guard: SendPostStateGuard,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);
  const postStateIdSql = buildSendPostStateIdSql(guard, input.auditId);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${postStateIdSql} AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_send_operation"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}

/** Direct send-operation audit without post-state guard (preflight blocks, dispatch authorization). */
export function buildSendOperationDirectAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    action: string;
    sendOperationId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${input.auditId} AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_send_operation"} AS entity_type,
        ${input.sendOperationId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

export function buildRfcIdentityGuardedInsert(
  db: Database,
  guard: SendPostStateGuard,
  input: {
    id: string;
    rfcMessageId: string;
    now: string;
  },
) {
  const sendOperationIdSql = buildSendPostStateIdSql(guard, guard.sendOperationId);

  return db.insert(schema.mailOutboundRfcIdentities).select(
    sql`
      SELECT
        ${input.id} AS id,
        ${sendOperationIdSql} AS send_operation_id,
        ${guard.outboundRevisionId} AS outbound_revision_id,
        ${input.rfcMessageId} AS rfc_message_id,
        ${input.now} AS created_at
      FROM (SELECT 1) AS rfc_driver
    `,
  );
}

export function buildTransportAttemptGuardedInsert(
  db: Database,
  guard: SendPostStateGuard,
  input: {
    id: string;
    attemptNumber: number;
    provider: string;
    now: string;
  },
) {
  const sendOperationIdSql = buildSendPostStateIdSql(guard, guard.sendOperationId);

  return db.insert(schema.mailTransportAttempts).select(
    sql`
      SELECT
        ${input.id} AS id,
        ${sendOperationIdSql} AS send_operation_id,
        ${input.attemptNumber} AS attempt_number,
        ${"started"} AS state,
        ${input.provider} AS provider,
        NULL AS provider_request_id,
        NULL AS provider_message_id,
        ${input.now} AS started_at,
        NULL AS completed_at,
        NULL AS retry_after_at,
        NULL AS error_code,
        NULL AS error_message
      FROM (SELECT 1) AS attempt_driver
    `,
  );
}

export type MaterializationPostStateGuard = {
  sendOperationId: string;
  outboundRevisionId: string;
  contentHash: string;
  hashVersion: number;
  acceptedTransportAttemptId: string;
};

function buildMaterializationPostStateIdSql(
  guard: MaterializationPostStateGuard,
  idValue: string,
): SQL {
  return sql`(
    SELECT ${idValue}
    FROM mail_send_operations s
    INNER JOIN mail_transport_attempts t
      ON t.id = ${guard.acceptedTransportAttemptId}
      AND t.send_operation_id = s.id
      AND t.state = 'accepted'
    WHERE s.id = ${guard.sendOperationId}
      AND s.outbound_revision_id = ${guard.outboundRevisionId}
      AND s.content_hash = ${guard.contentHash}
      AND s.hash_version = ${guard.hashVersion}
      AND s.status = 'accepted'
    LIMIT 1
  )`;
}

/**
 * Guarded materialization INSERT — only succeeds when Send is accepted and the
 * referenced Transport Attempt is accepted for the exact Send provenance.
 */
export function buildMaterializationGuardedInsert(
  db: Database,
  guard: MaterializationPostStateGuard,
  input: {
    id: string;
    outboundRfcIdentityId: string;
    rfcMessageId: string;
    wireInternetMessageId: string | null;
    mailMessageId: string;
    materializedAt: string;
  },
) {
  const sendOperationIdSql = buildMaterializationPostStateIdSql(
    guard,
    guard.sendOperationId,
  );

  return db.insert(schema.mailOutboundMessageMaterializations).select(
    sql`
      SELECT
        ${input.id} AS id,
        ${sendOperationIdSql} AS send_operation_id,
        ${guard.outboundRevisionId} AS outbound_revision_id,
        ${guard.contentHash} AS content_hash,
        ${guard.hashVersion} AS hash_version,
        ${guard.acceptedTransportAttemptId} AS accepted_transport_attempt_id,
        ${input.outboundRfcIdentityId} AS outbound_rfc_identity_id,
        ${input.rfcMessageId} AS rfc_message_id,
        ${input.wireInternetMessageId} AS wire_internet_message_id,
        ${input.mailMessageId} AS mail_message_id,
        ${"outbound"} AS message_direction,
        ${input.materializedAt} AS materialized_at
      FROM (SELECT 1) AS materialization_driver
    `,
  );
}

export function buildMaterializationPostStateGuardedAuditInsert(
  db: Database,
  input: {
    auditId: string;
    userId: string;
    now: string;
    action: string;
    sendOperationId: string;
    mailMessageId: string;
    metadata: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_outbound_message_materializations m
          WHERE m.send_operation_id = ${input.sendOperationId}
            AND m.mail_message_id = ${input.mailMessageId}
          LIMIT 1
        ) AS id,
        ${input.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_send_operation"} AS entity_type,
        ${input.sendOperationId} AS entity_id,
        ${input.ipAddress ?? null} AS ip_address,
        ${input.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}

/** Guarded audit that intentionally fails when materialization post-state does not match. */
export function buildInvalidMaterializationPostStateGuardedAuditInsert(
  db: Database,
  input: {
    auditId: string;
    userId: string;
    now: string;
    action: string;
    sendOperationId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_outbound_message_materializations m
          WHERE m.send_operation_id = ${"__invalid_materialization_guard__"}
          LIMIT 1
        ) AS id,
        ${input.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_send_operation"} AS entity_type,
        ${input.sendOperationId} AS entity_id,
        NULL AS ip_address,
        NULL AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}

/** Guarded audit that intentionally fails when send post-state does not match. */
export function buildInvalidSendPostStateGuardedAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_send_operations s
          WHERE s.id = ${"__invalid_send_guard__"}
          LIMIT 1
        ) AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_send_operation"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}
export type InboundMaterializationPostStateGuard = {
  ingestionEventId: string;
  completedProcessingVersion: number;
};

export function buildInboundProviderClaimProcessingUpdate(
  db: Database,
  input: {
    ingestionEventId: string;
    expectedProcessingVersion: number;
    nextProcessingVersion: number;
    processingStartedAt: string;
    processingLeaseExpiresAt: string;
  },
) {
  return db
    .update(schema.mailProviderIngestionEvents)
    .set({
      status: "processing",
      processingVersion: input.nextProcessingVersion,
      nextAttemptAt: null,
      processingStartedAt: input.processingStartedAt,
      processingLeaseExpiresAt: input.processingLeaseExpiresAt,
    })
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.id, input.ingestionEventId),
        eq(schema.mailProviderIngestionEvents.status, "pending"),
        eq(
          schema.mailProviderIngestionEvents.processingVersion,
          input.expectedProcessingVersion,
        ),
        isNull(schema.mailProviderIngestionEvents.processingStartedAt),
        isNull(schema.mailProviderIngestionEvents.processingLeaseExpiresAt),
      ),
    );
}

export function buildInboundProviderCompletedCasUpdate(
  db: Database,
  guard: InboundMaterializationPostStateGuard,
  input: {
    processingProcessingVersion: number;
    finalizedAt: string;
  },
) {
  return db
    .update(schema.mailProviderIngestionEvents)
    .set({
      status: "completed",
      processingVersion: guard.completedProcessingVersion,
      finalizedAt: input.finalizedAt,
      nextAttemptAt: null,
      processingStartedAt: null,
      processingLeaseExpiresAt: null,
    })
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.id, guard.ingestionEventId),
        eq(schema.mailProviderIngestionEvents.status, "processing"),
        eq(
          schema.mailProviderIngestionEvents.processingVersion,
          input.processingProcessingVersion,
        ),
      ),
    );
}

export function buildInboundProviderQuarantineUpdate(
  db: Database,
  input: {
    ingestionEventId: string;
    processingProcessingVersion: number;
    nextProcessingVersion: number;
    finalizedAt: string;
    quarantineReason: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
) {
  return db
    .update(schema.mailProviderIngestionEvents)
    .set({
      status: "quarantined",
      processingVersion: input.nextProcessingVersion,
      finalizedAt: input.finalizedAt,
      quarantineReason: input.quarantineReason,
      nextAttemptAt: null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      processingStartedAt: null,
      processingLeaseExpiresAt: null,
    })
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.id, input.ingestionEventId),
        eq(schema.mailProviderIngestionEvents.status, "processing"),
        eq(
          schema.mailProviderIngestionEvents.processingVersion,
          input.processingProcessingVersion,
        ),
      ),
    );
}

/**
 * Guarded inbound materialization INSERT — only succeeds when provider ingestion
 * is completed at the exact post-state processing_version.
 */
export function buildInboundMaterializationGuardedInsert(
  db: Database,
  guard: InboundMaterializationPostStateGuard,
  input: {
    id: string;
    receivingAddressId: string;
    routeOwnerMailboxId: string;
    routedAddressSnapshot: string;
    envelopeRecipientAddress: string;
    mailMessageId: string;
    materializedMailboxId: string;
    routeMode: "direct" | "fallback";
    fallbackReason: string | null;
    materializedAt: string;
  },
) {
  return db.insert(schema.mailInboundMessageMaterializations).select(
    sql`
      SELECT
        ${input.id} AS id,
        (
          SELECT i.ingestion_event_id
          FROM mail_inbound_ingestion_events i
          INNER JOIN mail_provider_ingestion_events p
            ON p.id = i.ingestion_event_id
          WHERE i.ingestion_event_id = ${guard.ingestionEventId}
            AND p.status = 'completed'
            AND p.processing_version = ${guard.completedProcessingVersion}
          LIMIT 1
        ) AS ingestion_event_id,
        ${input.receivingAddressId} AS receiving_address_id,
        ${input.routeOwnerMailboxId} AS route_owner_mailbox_id,
        ${input.routedAddressSnapshot} AS routed_address_snapshot,
        ${input.envelopeRecipientAddress} AS envelope_recipient_address,
        ${input.mailMessageId} AS mail_message_id,
        ${input.materializedMailboxId} AS materialized_mailbox_id,
        ${input.routeMode} AS route_mode,
        ${input.fallbackReason} AS fallback_reason,
        ${"inbound"} AS message_direction,
        ${input.materializedAt} AS materialized_at
      FROM (SELECT 1) AS inbound_materialization_driver
    `,
  );
}

export function buildInboundMaterializationGuardedAuditInsert(
  db: Database,
  input: {
    auditId: string;
    now: string;
    action: string;
    ingestionEventId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_inbound_message_materializations m
          WHERE m.ingestion_event_id = ${input.ingestionEventId}
          LIMIT 1
        ) AS id,
        NULL AS user_id,
        ${input.action} AS action,
        ${"mail_provider_ingestion_event"} AS entity_type,
        ${input.ingestionEventId} AS entity_id,
        NULL AS ip_address,
        NULL AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}

export type DeliveryMaterializationPostStateGuard = {
  ingestionEventId: string;
  completedProcessingVersion: number;
};

export function buildProviderReleasePendingUpdate(
  db: Database,
  input: {
    ingestionEventId: string;
    processingProcessingVersion: number;
    nextProcessingVersion: number;
    nextAttemptAt?: string | null;
  },
) {
  return db
    .update(schema.mailProviderIngestionEvents)
    .set({
      status: "pending",
      processingVersion: input.nextProcessingVersion,
      nextAttemptAt: input.nextAttemptAt ?? null,
      processingStartedAt: null,
      processingLeaseExpiresAt: null,
    })
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.id, input.ingestionEventId),
        eq(schema.mailProviderIngestionEvents.status, "processing"),
        eq(
          schema.mailProviderIngestionEvents.processingVersion,
          input.processingProcessingVersion,
        ),
      ),
    );
}

/**
 * Guarded delivery materialization INSERT — only succeeds when provider ingestion
 * is completed at the exact post-state processing_version.
 */
export function buildDeliveryMaterializationGuardedInsert(
  db: Database,
  guard: DeliveryMaterializationPostStateGuard,
  input: {
    id: string;
    deliveryEventId: string;
    eventDedupeKey: string;
    deliveryEventType: string;
    materializedAt: string;
  },
) {
  return db.insert(schema.mailDeliveryEventMaterializations).select(
    sql`
      SELECT
        ${input.id} AS id,
        (
          SELECT d.ingestion_event_id
          FROM mail_delivery_ingestion_events d
          INNER JOIN mail_provider_ingestion_events p
            ON p.id = d.ingestion_event_id
          WHERE d.ingestion_event_id = ${guard.ingestionEventId}
            AND p.status = 'completed'
            AND p.processing_version = ${guard.completedProcessingVersion}
          LIMIT 1
        ) AS ingestion_event_id,
        ${input.deliveryEventId} AS delivery_event_id,
        ${input.eventDedupeKey} AS event_dedupe_key,
        ${input.deliveryEventType} AS delivery_event_type,
        ${input.materializedAt} AS materialized_at
      FROM (SELECT 1) AS delivery_materialization_driver
    `,
  );
}

export function buildDeliveryMaterializationGuardedAuditInsert(
  db: Database,
  input: {
    auditId: string;
    now: string;
    action: string;
    ingestionEventId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_delivery_event_materializations m
          WHERE m.ingestion_event_id = ${input.ingestionEventId}
          LIMIT 1
        ) AS id,
        NULL AS user_id,
        ${input.action} AS action,
        ${"mail_provider_ingestion_event"} AS entity_type,
        ${input.ingestionEventId} AS entity_id,
        NULL AS ip_address,
        NULL AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}

/** CAS quarantined → pending transition per frozen 0061 status CHECK. */
export function buildProviderQuarantineReplayUpdate(
  db: Database,
  input: {
    ingestionEventId: string;
    expectedProcessingVersion: number;
    nextProcessingVersion: number;
  },
) {
  return db
    .update(schema.mailProviderIngestionEvents)
    .set({
      status: "pending",
      processingVersion: input.nextProcessingVersion,
      finalizedAt: null,
      quarantineReason: null,
      nextAttemptAt: null,
      errorCode: null,
      errorMessage: null,
      processingStartedAt: null,
      processingLeaseExpiresAt: null,
    })
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.id, input.ingestionEventId),
        eq(schema.mailProviderIngestionEvents.status, "quarantined"),
        eq(
          schema.mailProviderIngestionEvents.processingVersion,
          input.expectedProcessingVersion,
        ),
      ),
    );
}

export function buildIngestionQuarantineReplayAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    action: string;
    ingestionEventId: string;
    nextProcessingVersion: number;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_provider_ingestion_events p
          WHERE p.id = ${input.ingestionEventId}
            AND p.status = 'pending'
            AND p.processing_version = ${input.nextProcessingVersion}
            AND p.quarantine_reason IS NULL
            AND p.finalized_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM audit_logs a
              WHERE a.entity_type = 'mail_provider_ingestion_event'
                AND a.entity_id = p.id
                AND a.action = ${input.action}
                AND json_extract(a.metadata, '$.newProcessingVersion') = ${input.nextProcessingVersion}
            )
          LIMIT 1
        ) AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_provider_ingestion_event"} AS entity_type,
        ${input.ingestionEventId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}

/** CAS expired processing → pending recovery per 0065 lease contract. */
export function buildProviderProcessingRecoveryUpdate(
  db: Database,
  input: {
    ingestionEventId: string;
    expectedProcessingVersion: number;
    nextProcessingVersion: number;
    trustNow: string;
  },
) {
  return db
    .update(schema.mailProviderIngestionEvents)
    .set({
      status: "pending",
      processingVersion: input.nextProcessingVersion,
      nextAttemptAt: null,
      processingStartedAt: null,
      processingLeaseExpiresAt: null,
    })
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.id, input.ingestionEventId),
        eq(schema.mailProviderIngestionEvents.status, "processing"),
        eq(
          schema.mailProviderIngestionEvents.processingVersion,
          input.expectedProcessingVersion,
        ),
        lte(
          schema.mailProviderIngestionEvents.processingLeaseExpiresAt,
          input.trustNow,
        ),
      ),
    );
}

export function buildIngestionProcessingRecoveryAuditInsert(
  db: Database,
  actor: MailOperationalActor,
  input: {
    auditId: string;
    now: string;
    action: string;
    ingestionEventId: string;
    nextProcessingVersion: number;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(
    withSystemAuditMetadata(actor, input.metadata),
  );

  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_provider_ingestion_events p
          WHERE p.id = ${input.ingestionEventId}
            AND p.status = 'pending'
            AND p.processing_version = ${input.nextProcessingVersion}
            AND p.processing_started_at IS NULL
            AND p.processing_lease_expires_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM audit_logs a
              WHERE a.entity_type = 'mail_provider_ingestion_event'
                AND a.entity_id = p.id
                AND a.action = ${input.action}
                AND json_extract(a.metadata, '$.newProcessingVersion') = ${input.nextProcessingVersion}
            )
          LIMIT 1
        ) AS id,
        ${resolveMailAuditUserId(actor)} AS user_id,
        ${input.action} AS action,
        ${"mail_provider_ingestion_event"} AS entity_type,
        ${input.ingestionEventId} AS entity_id,
        ${resolveMailAuditIpAddress(actor)} AS ip_address,
        ${resolveMailAuditUserAgent(actor)} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}

export function buildNotificationOutboxAuditInsert(
  db: Database,
  actor: MailOperationalActor,
  input: {
    auditId: string;
    now: string;
    action: string;
    outboxId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(
    withSystemAuditMetadata(actor, input.metadata),
  );
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${input.auditId} AS id,
        ${resolveMailAuditUserId(actor)} AS user_id,
        ${input.action} AS action,
        ${"mail_notification_outbox"} AS entity_type,
        ${input.outboxId} AS entity_id,
        ${resolveMailAuditIpAddress(actor)} AS ip_address,
        ${resolveMailAuditUserAgent(actor)} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

export function buildNotificationOutboxPostStateAuditInsert(
  db: Database,
  actor: MailOperationalActor,
  input: {
    auditId: string;
    now: string;
    action: string;
    outboxId: string;
    expectedProcessingVersion: number;
    expectedStatus: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(
    withSystemAuditMetadata(actor, input.metadata),
  );
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        (
          SELECT ${input.auditId}
          FROM mail_notification_outbox o
          WHERE o.id = ${input.outboxId}
            AND o.processing_version = ${input.expectedProcessingVersion}
            AND o.status = ${input.expectedStatus}
          LIMIT 1
        ) AS id,
        ${resolveMailAuditUserId(actor)} AS user_id,
        ${input.action} AS action,
        ${"mail_notification_outbox"} AS entity_type,
        ${input.outboxId} AS entity_id,
        ${resolveMailAuditIpAddress(actor)} AS ip_address,
        ${resolveMailAuditUserAgent(actor)} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
      FROM (SELECT 1) AS audit_driver
    `,
  );
}
