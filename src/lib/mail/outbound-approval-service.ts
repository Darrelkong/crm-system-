import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { MailOutboundApproval } from "../../../drizzle/schema/mail-outbound-approvals";
import type { MailOutboundApprovalEvent } from "../../../drizzle/schema/mail-outbound-approval-events";
import type { MailOutboundRevision } from "../../../drizzle/schema/mail-outbound-revisions";
import {
  MAIL_OUTBOUND_APPROVAL_PRIORITIES,
  type MailOutboundApprovalPriority,
} from "../../../drizzle/schema/mail-outbound-approvals";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { assertCanComposeFromIdentityInMailbox } from "@/lib/mail/compose-authorization";
import {
  CANONICAL_CONTENT_HASH_VERSION,
  MAIL_AUDIT_ACTIONS,
} from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  buildApprovedSendIdempotencyKey,
  buildSendOperationCreation,
  validateStaffApprovedSendRevision,
} from "@/lib/mail/send-operation-service";
import {
  buildApprovalPostStateGuardedAuditInsert,
  buildApprovalTransitionGuardedEventInsert,
  isMailPostStateGuardError,
  runMailBatch,
  type ApprovalPostStateGuard,
} from "@/lib/mail/guarded-batch";
import {
  toSafeApprovalView,
  type SafeApprovalRevisionSummaryView,
  type SafeApprovalView,
} from "@/lib/mail/outbound-approval-serialization";
import { toSafeOutboundRevisionRecipientView } from "@/lib/mail/outbound-revision-serialization";
import { recomputeOutboundRevisionContentHash } from "@/lib/mail/outbound-revision-service";
import {
  assertEffectiveMailAccess,
  assertMailOutboundApprovalReview,
} from "@/lib/permissions/mail";
import { buildResolvedNotificationIntentInsert } from "@/lib/mail/notification-outbox-batch-enqueue";
import { resolveApprovalReturnedNotificationTarget } from "@/lib/mail/notification-source-recipient-resolution";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import { assertRevisionOrdinaryEmailAttachmentsWithinPolicy } from "@/lib/mail/outbound-send-preflight-service";
import { transitionRevisionLargeAttachmentsForStaffSubmit } from "@/lib/mail/large-attachment/large-attachment-approval-lifecycle-service";
import { assertRevisionLargeAttachmentsInspectableForApproval } from "@/lib/mail/large-attachment/large-attachment-approval-inspection-service";

/**
 * Staff outbound Approval workflow service (frozen 0056).
 *
 * V1 terminal workflow contract (2C.6.1):
 * - `returned` is NON-TERMINAL — author may create a new Revision in the SAME
 *   revision_chain_id and resubmit to `pending`.
 * - `approved` is TERMINAL for this revision_chain_id — no resubmit; changed
 *   content requires a NEW revision chain and new Approval workflow.
 * - `withdrawn` is TERMINAL for this revision_chain_id — no resubmit; revised
 *   content requires a NEW revision chain and new Approval workflow.
 * - No `approved → pending` or `withdrawn → pending` transitions.
 *
 * Reviewer permission (2C.6.2): `approval_review` OR `super_admin` required.
 *
 * `admin_edit` event type is reserved for future Admin-edit/direct-send path;
 * it does not mutate approved Staff Revision provenance.
 */

const STAFF_APPROVAL_REVISION_KINDS = new Set([
  "staff_submit",
  "staff_resubmit",
]);

type ApprovalListStatus = MailOutboundApproval["status"] | "all-reviewed";

async function findApprovalById(
  db: Database,
  approvalId: string,
): Promise<MailOutboundApproval | null> {
  const [row] = await db
    .select()
    .from(schema.mailOutboundApprovals)
    .where(eq(schema.mailOutboundApprovals.id, approvalId))
    .limit(1);
  return row ?? null;
}

async function findApprovalByChainId(
  db: Database,
  revisionChainId: string,
): Promise<MailOutboundApproval | null> {
  const [row] = await db
    .select()
    .from(schema.mailOutboundApprovals)
    .where(eq(schema.mailOutboundApprovals.revisionChainId, revisionChainId))
    .limit(1);
  return row ?? null;
}

async function findRevisionById(
  db: Database,
  revisionId: string,
): Promise<MailOutboundRevision | null> {
  const [row] = await db
    .select()
    .from(schema.mailOutboundRevisions)
    .where(eq(schema.mailOutboundRevisions.id, revisionId))
    .limit(1);
  return row ?? null;
}

async function loadApprovalEvents(db: Database, approvalId: string) {
  return db
    .select()
    .from(schema.mailOutboundApprovalEvents)
    .where(eq(schema.mailOutboundApprovalEvents.approvalId, approvalId))
    .orderBy(asc(schema.mailOutboundApprovalEvents.createdAt));
}

async function loadApprovalEventsForList(
  db: Database,
  approvals: MailOutboundApproval[],
): Promise<Map<string, MailOutboundApprovalEvent[]>> {
  const approvalIds = [...new Set(approvals.map((approval) => approval.id))];
  if (approvalIds.length === 0) {
    return new Map();
  }
  const events = await db
    .select()
    .from(schema.mailOutboundApprovalEvents)
    .where(inArray(schema.mailOutboundApprovalEvents.approvalId, approvalIds))
    .orderBy(asc(schema.mailOutboundApprovalEvents.createdAt));
  const eventsByApprovalId = new Map<string, MailOutboundApprovalEvent[]>();
  for (const event of events) {
    const current = eventsByApprovalId.get(event.approvalId) ?? [];
    current.push(event);
    eventsByApprovalId.set(event.approvalId, current);
  }
  return eventsByApprovalId;
}

async function loadApprovalRevisionSummaries(
  db: Database,
  approvals: MailOutboundApproval[],
): Promise<Map<string, SafeApprovalRevisionSummaryView>> {
  const revisionIds = [...new Set(approvals.map((approval) => approval.currentRevisionId))];
  if (revisionIds.length === 0) {
    return new Map();
  }

  const [revisions, recipients] = await Promise.all([
    db
      .select()
      .from(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.id, revisionIds)),
    db
      .select()
      .from(schema.mailOutboundRevisionRecipients)
      .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds))
      .orderBy(asc(schema.mailOutboundRevisionRecipients.sortOrder)),
  ]);
  const recipientsByRevisionId = new Map<string, typeof recipients>();
  for (const recipient of recipients) {
    const current = recipientsByRevisionId.get(recipient.revisionId) ?? [];
    current.push(recipient);
    recipientsByRevisionId.set(recipient.revisionId, current);
  }

  return new Map(
    revisions.map((revision) => [
      revision.id,
      {
        id: revision.id,
        revisionChainId: revision.revisionChainId,
        revisionNumber: revision.revisionNumber,
        sourceDraftId: revision.sourceDraftId,
        fromAddress: revision.fromAddress,
        fromDisplayName: revision.fromDisplayName,
        subject: revision.subject,
        composeMode: revision.composeMode,
        createdAt: revision.createdAt,
        recipients: (recipientsByRevisionId.get(revision.id) ?? []).map(
          toSafeOutboundRevisionRecipientView,
        ),
      },
    ]),
  );
}

function assertStaffRevisionKind(revision: MailOutboundRevision): void {
  if (!STAFF_APPROVAL_REVISION_KINDS.has(revision.revisionKind)) {
    throw MailServiceError.validation(
      "Only Staff outbound revisions may enter the approval workflow",
    );
  }
}

async function verifyRevisionContentIntegrity(
  db: Database,
  revision: MailOutboundRevision,
): Promise<{ contentHash: string; hashVersion: number }> {
  if (revision.hashVersion !== CANONICAL_CONTENT_HASH_VERSION) {
    throw MailServiceError.integrityConflict(
      "Revision hash version is not supported",
      { hashVersion: revision.hashVersion },
    );
  }

  const recomputed = await recomputeOutboundRevisionContentHash(db, revision.id);
  if (recomputed.contentHash !== revision.contentHash) {
    throw MailServiceError.integrityConflict(
      "Revision content hash mismatch",
      {
        revisionId: revision.id,
        storedHash: revision.contentHash,
        recomputedHash: recomputed.contentHash,
      },
    );
  }
  if (recomputed.hashVersion !== revision.hashVersion) {
    throw MailServiceError.integrityConflict("Revision hash version mismatch");
  }

  return recomputed;
}

async function assertRevisionSubmissionAuthorization(
  db: Database,
  actor: MailActorContext,
  revision: MailOutboundRevision,
): Promise<void> {
  assertEffectiveMailAccess(actor);
  if (revision.createdByUserId !== actor.userId) {
    throw MailServiceError.forbidden("Revision author authorization required");
  }
  await assertCanComposeFromIdentityInMailbox(db, actor, {
    senderIdentityId: revision.senderIdentityId,
    mailboxId: revision.mailboxId,
  });
}

function assertApprovalAuthor(
  approval: MailOutboundApproval,
  actor: MailActorContext,
): void {
  if (approval.requestedByUserId !== actor.userId) {
    throw MailServiceError.forbidden("Approval author authorization required");
  }
}

function assertNotSelfReview(
  approval: MailOutboundApproval,
  actor: MailActorContext,
): void {
  if (approval.requestedByUserId === actor.userId) {
    throw MailServiceError.forbidden(
      "Staff may not review their own approval submission",
    );
  }
}

function parsePriority(
  priority: MailOutboundApprovalPriority | undefined,
): MailOutboundApprovalPriority {
  if (priority === undefined) {
    return "normal";
  }
  if (!(MAIL_OUTBOUND_APPROVAL_PRIORITIES as readonly string[]).includes(priority)) {
    throw MailServiceError.validation("Invalid approval priority");
  }
  return priority;
}

function assertReturnNote(note: string | undefined): string {
  const trimmed = note?.trim() ?? "";
  if (!trimmed) {
    throw MailServiceError.validation("Return reason is required");
  }
  return trimmed;
}

async function assertCanReadApproval(
  db: Database,
  actor: MailActorContext,
  approval: MailOutboundApproval,
): Promise<void> {
  if (approval.requestedByUserId === actor.userId) {
    assertEffectiveMailAccess(actor);
    return;
  }
  assertMailOutboundApprovalReview(actor);
}

async function loadApprovalView(
  db: Database,
  approval: MailOutboundApproval,
  includeEvents = false,
): Promise<SafeApprovalView> {
  const events = includeEvents
    ? await loadApprovalEvents(db, approval.id)
    : undefined;
  return toSafeApprovalView(approval, events);
}

function handleApprovalBatchError(error: unknown): never {
  if (isMailPostStateGuardError(error)) {
    throw MailServiceError.staleVersion("Approval workflow version conflict");
  }
  if (isUniqueConstraintError(error)) {
    throw MailServiceError.conflict("Approval workflow already exists");
  }
  throw error;
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

export async function submitRevisionForApproval(
  db: Database,
  actor: MailActorContext,
  input: { revisionId: string; priority?: MailOutboundApprovalPriority },
): Promise<SafeApprovalView> {
  const revision = await findRevisionById(db, input.revisionId);
  if (!revision) {
    throw MailServiceError.notFound("Outbound revision not found");
  }

  assertStaffRevisionKind(revision);
  await assertRevisionSubmissionAuthorization(db, actor, revision);
  await assertRevisionOrdinaryEmailAttachmentsWithinPolicy(db, revision.id);
  const { contentHash, hashVersion } = await verifyRevisionContentIntegrity(
    db,
    revision,
  );

  const existing = await findApprovalByChainId(db, revision.revisionChainId);
  if (existing) {
    if (
      existing.status === "pending" &&
      existing.currentRevisionId === revision.id &&
      existing.currentContentHash === contentHash &&
      existing.currentHashVersion === hashVersion
    ) {
      return loadApprovalView(db, existing, true);
    }
    throw MailServiceError.conflict(
      "Approval workflow already exists for this revision chain",
      {
        approvalId: existing.id,
        status: existing.status,
      },
    );
  }

  const now = new Date().toISOString();
  const approvalId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const priority = parsePriority(input.priority);

  const postState: ApprovalPostStateGuard = {
    approvalId,
    revisionChainId: revision.revisionChainId,
    workflowVersion: 1,
    status: "pending",
    currentRevisionId: revision.id,
    currentContentHash: contentHash,
    currentHashVersion: hashVersion,
  };

  try {
    await runMailBatch(db, [
      db.insert(schema.mailOutboundApprovals).values({
        id: approvalId,
        revisionChainId: revision.revisionChainId,
        status: "pending",
        priority,
        workflowVersion: 1,
        currentRevisionId: revision.id,
        currentContentHash: contentHash,
        currentHashVersion: hashVersion,
        requestedByUserId: actor.userId,
        requestedAt: now,
      }),
      buildApprovalTransitionGuardedEventInsert(db, postState, {
        eventId,
        eventType: "submitted",
        revisionId: revision.id,
        contentHash,
        hashVersion,
        actorUserId: actor.userId,
        now,
      }),
      buildApprovalPostStateGuardedAuditInsert(db, actor, postState, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.approvalSubmitted,
        entityId: approvalId,
        metadata: {
          approvalId,
          revisionChainId: revision.revisionChainId,
          revisionId: revision.id,
          contentHash,
          hashVersion,
          workflowVersion: 1,
          priority,
          authorUserId: actor.userId,
          status: "pending",
        },
      }),
    ]);
  } catch (error) {
    handleApprovalBatchError(error);
  }

  await transitionRevisionLargeAttachmentsForStaffSubmit(db, {
    revisionId: revision.id,
    firstSubmittedAt: now,
    now,
  });

  const approval = await findApprovalById(db, approvalId);
  if (!approval) {
    throw MailServiceError.integrityConflict("Approval submission failed");
  }
  return loadApprovalView(db, approval, true);
}

export async function resubmitRevisionForApproval(
  db: Database,
  actor: MailActorContext,
  input: {
    approvalId: string;
    revisionId: string;
    expectedWorkflowVersion: number;
    priority?: MailOutboundApprovalPriority;
  },
): Promise<SafeApprovalView> {
  const approval = await findApprovalById(db, input.approvalId);
  if (!approval) {
    throw MailServiceError.notFound("Approval workflow not found");
  }
  assertApprovalAuthor(approval, actor);

  if (approval.workflowVersion !== input.expectedWorkflowVersion) {
    throw MailServiceError.staleVersion("Approval workflow version conflict");
  }
  if (approval.status !== "returned") {
    throw MailServiceError.conflict(
      "Approval must be returned before resubmission",
      { status: approval.status },
    );
  }

  const revision = await findRevisionById(db, input.revisionId);
  if (!revision) {
    throw MailServiceError.notFound("Outbound revision not found");
  }
  if (revision.revisionChainId !== approval.revisionChainId) {
    throw MailServiceError.validation(
      "Revision must belong to the approval revision chain",
    );
  }
  assertStaffRevisionKind(revision);
  await assertRevisionSubmissionAuthorization(db, actor, revision);
  const { contentHash, hashVersion } = await verifyRevisionContentIntegrity(
    db,
    revision,
  );

  const now = new Date().toISOString();
  const newVersion = approval.workflowVersion + 1;
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const priority =
    input.priority !== undefined
      ? parsePriority(input.priority)
      : approval.priority;

  const postState: ApprovalPostStateGuard = {
    approvalId: approval.id,
    revisionChainId: approval.revisionChainId,
    workflowVersion: newVersion,
    status: "pending",
    currentRevisionId: revision.id,
    currentContentHash: contentHash,
    currentHashVersion: hashVersion,
  };

  try {
    await runMailBatch(db, [
      db
        .update(schema.mailOutboundApprovals)
        .set({
          status: "pending",
          priority,
          workflowVersion: newVersion,
          currentRevisionId: revision.id,
          currentContentHash: contentHash,
          currentHashVersion: hashVersion,
          resolvedByUserId: null,
          resolvedAt: null,
          nextReminderAt: null,
        })
        .where(
          and(
            eq(schema.mailOutboundApprovals.id, approval.id),
            eq(
              schema.mailOutboundApprovals.workflowVersion,
              approval.workflowVersion,
            ),
            eq(schema.mailOutboundApprovals.status, "returned"),
            eq(
              schema.mailOutboundApprovals.currentRevisionId,
              approval.currentRevisionId,
            ),
            eq(
              schema.mailOutboundApprovals.currentContentHash,
              approval.currentContentHash,
            ),
            eq(
              schema.mailOutboundApprovals.currentHashVersion,
              approval.currentHashVersion,
            ),
          ),
        ),
      buildApprovalTransitionGuardedEventInsert(db, postState, {
        eventId,
        eventType: "resubmitted",
        revisionId: revision.id,
        contentHash,
        hashVersion,
        actorUserId: actor.userId,
        now,
      }),
      buildApprovalPostStateGuardedAuditInsert(db, actor, postState, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.approvalResubmitted,
        entityId: approval.id,
        metadata: {
          approvalId: approval.id,
          revisionChainId: approval.revisionChainId,
          revisionId: revision.id,
          contentHash,
          hashVersion,
          workflowVersion: newVersion,
          previousWorkflowVersion: approval.workflowVersion,
          priority,
          authorUserId: actor.userId,
          status: "pending",
        },
      }),
    ]);
  } catch (error) {
    handleApprovalBatchError(error);
  }

  await transitionRevisionLargeAttachmentsForStaffSubmit(db, {
    revisionId: revision.id,
    firstSubmittedAt: approval.requestedAt,
    now,
  });

  const updated = await findApprovalById(db, approval.id);
  if (!updated) {
    throw MailServiceError.integrityConflict("Approval resubmission failed");
  }
  return loadApprovalView(db, updated, true);
}

export async function returnApproval(
  db: Database,
  actor: MailActorContext,
  input: {
    approvalId: string;
    expectedWorkflowVersion: number;
    note: string;
  },
): Promise<SafeApprovalView> {
  assertMailOutboundApprovalReview(actor);

  const approval = await findApprovalById(db, input.approvalId);
  if (!approval) {
    throw MailServiceError.notFound("Approval workflow not found");
  }
  assertNotSelfReview(approval, actor);

  if (approval.workflowVersion !== input.expectedWorkflowVersion) {
    throw MailServiceError.staleVersion("Approval workflow version conflict");
  }
  if (approval.status !== "pending") {
    throw MailServiceError.conflict("Approval must be pending to return", {
      status: approval.status,
    });
  }

  const revision = await findRevisionById(db, approval.currentRevisionId);
  if (!revision) {
    throw MailServiceError.integrityConflict("Current revision missing");
  }
  const { contentHash, hashVersion } = await verifyRevisionContentIntegrity(
    db,
    revision,
  );
  if (
    contentHash !== approval.currentContentHash ||
    hashVersion !== approval.currentHashVersion
  ) {
    throw MailServiceError.integrityConflict(
      "Approval current revision hash mismatch",
    );
  }

  const note = assertReturnNote(input.note);
  const now = new Date().toISOString();
  const newVersion = approval.workflowVersion + 1;
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  const postState: ApprovalPostStateGuard = {
    approvalId: approval.id,
    revisionChainId: approval.revisionChainId,
    workflowVersion: newVersion,
    status: "returned",
    currentRevisionId: approval.currentRevisionId,
    currentContentHash: approval.currentContentHash,
    currentHashVersion: approval.currentHashVersion,
  };

  const notificationTarget = await resolveApprovalReturnedNotificationTarget(
    db,
    approval.requestedByUserId,
  );

  try {
    const batchStatements: Parameters<typeof runMailBatch>[1] = [
      db
        .update(schema.mailOutboundApprovals)
        .set({
          status: "returned",
          workflowVersion: newVersion,
          resolvedByUserId: actor.userId,
          resolvedAt: now,
          nextReminderAt: null,
        })
        .where(
          and(
            eq(schema.mailOutboundApprovals.id, approval.id),
            eq(
              schema.mailOutboundApprovals.workflowVersion,
              approval.workflowVersion,
            ),
            eq(schema.mailOutboundApprovals.status, "pending"),
            eq(
              schema.mailOutboundApprovals.currentRevisionId,
              approval.currentRevisionId,
            ),
            eq(
              schema.mailOutboundApprovals.currentContentHash,
              approval.currentContentHash,
            ),
            eq(
              schema.mailOutboundApprovals.currentHashVersion,
              approval.currentHashVersion,
            ),
          ),
        ),
      buildApprovalTransitionGuardedEventInsert(db, postState, {
        eventId,
        eventType: "returned",
        revisionId: approval.currentRevisionId,
        contentHash: approval.currentContentHash,
        hashVersion: approval.currentHashVersion,
        actorUserId: actor.userId,
        note,
        now,
      }),
    ];

    if (notificationTarget) {
      batchStatements.push(
        buildResolvedNotificationIntentInsert(db, {
          target: notificationTarget,
          notificationType: "approval_returned",
          sourceEntityType:
            MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailOutboundApprovalEvent,
          sourceEntityId: eventId,
          now,
        }),
      );
    }

    batchStatements.push(
      buildApprovalPostStateGuardedAuditInsert(db, actor, postState, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.approvalReturned,
        entityId: approval.id,
        metadata: {
          approvalId: approval.id,
          revisionChainId: approval.revisionChainId,
          revisionId: approval.currentRevisionId,
          contentHash: approval.currentContentHash,
          hashVersion: approval.currentHashVersion,
          workflowVersion: newVersion,
          reviewerUserId: actor.userId,
          status: "returned",
        },
      }),
    );

    await runMailBatch(db, batchStatements);
  } catch (error) {
    handleApprovalBatchError(error);
  }

  const updated = await findApprovalById(db, approval.id);
  if (!updated) {
    throw MailServiceError.integrityConflict("Approval return failed");
  }
  return loadApprovalView(db, updated, true);
}

export async function withdrawApproval(
  db: Database,
  actor: MailActorContext,
  input: { approvalId: string; expectedWorkflowVersion: number },
): Promise<SafeApprovalView> {
  const approval = await findApprovalById(db, input.approvalId);
  if (!approval) {
    throw MailServiceError.notFound("Approval workflow not found");
  }
  assertApprovalAuthor(approval, actor);

  if (approval.workflowVersion !== input.expectedWorkflowVersion) {
    throw MailServiceError.staleVersion("Approval workflow version conflict");
  }
  if (approval.status !== "pending") {
    throw MailServiceError.conflict("Approval must be pending to withdraw", {
      status: approval.status,
    });
  }

  const now = new Date().toISOString();
  const newVersion = approval.workflowVersion + 1;
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  const postState: ApprovalPostStateGuard = {
    approvalId: approval.id,
    revisionChainId: approval.revisionChainId,
    workflowVersion: newVersion,
    status: "withdrawn",
    currentRevisionId: approval.currentRevisionId,
    currentContentHash: approval.currentContentHash,
    currentHashVersion: approval.currentHashVersion,
  };

  try {
    await runMailBatch(db, [
      db
        .update(schema.mailOutboundApprovals)
        .set({
          status: "withdrawn",
          workflowVersion: newVersion,
          resolvedByUserId: actor.userId,
          resolvedAt: now,
          nextReminderAt: null,
        })
        .where(
          and(
            eq(schema.mailOutboundApprovals.id, approval.id),
            eq(
              schema.mailOutboundApprovals.workflowVersion,
              approval.workflowVersion,
            ),
            eq(schema.mailOutboundApprovals.status, "pending"),
            eq(
              schema.mailOutboundApprovals.currentRevisionId,
              approval.currentRevisionId,
            ),
            eq(
              schema.mailOutboundApprovals.currentContentHash,
              approval.currentContentHash,
            ),
            eq(
              schema.mailOutboundApprovals.currentHashVersion,
              approval.currentHashVersion,
            ),
          ),
        ),
      buildApprovalTransitionGuardedEventInsert(db, postState, {
        eventId,
        eventType: "withdrawn",
        revisionId: approval.currentRevisionId,
        contentHash: approval.currentContentHash,
        hashVersion: approval.currentHashVersion,
        actorUserId: actor.userId,
        now,
      }),
      buildApprovalPostStateGuardedAuditInsert(db, actor, postState, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.approvalWithdrawn,
        entityId: approval.id,
        metadata: {
          approvalId: approval.id,
          revisionChainId: approval.revisionChainId,
          revisionId: approval.currentRevisionId,
          contentHash: approval.currentContentHash,
          hashVersion: approval.currentHashVersion,
          workflowVersion: newVersion,
          authorUserId: actor.userId,
          status: "withdrawn",
        },
      }),
    ]);
  } catch (error) {
    handleApprovalBatchError(error);
  }

  const updated = await findApprovalById(db, approval.id);
  if (!updated) {
    throw MailServiceError.integrityConflict("Approval withdrawal failed");
  }
  return loadApprovalView(db, updated, true);
}

export async function approveRevision(
  db: Database,
  actor: MailActorContext,
  input: { approvalId: string; expectedWorkflowVersion: number },
): Promise<SafeApprovalView> {
  assertMailOutboundApprovalReview(actor);

  const approval = await findApprovalById(db, input.approvalId);
  if (!approval) {
    throw MailServiceError.notFound("Approval workflow not found");
  }
  assertNotSelfReview(approval, actor);

  if (approval.workflowVersion !== input.expectedWorkflowVersion) {
    throw MailServiceError.staleVersion("Approval workflow version conflict");
  }
  if (approval.status !== "pending") {
    throw MailServiceError.conflict("Approval must be pending to approve", {
      status: approval.status,
    });
  }

  const revision = await findRevisionById(db, approval.currentRevisionId);
  if (!revision) {
    throw MailServiceError.integrityConflict("Current revision missing");
  }
  const { contentHash, hashVersion } = await verifyRevisionContentIntegrity(
    db,
    revision,
  );
  if (
    contentHash !== approval.currentContentHash ||
    hashVersion !== approval.currentHashVersion
  ) {
    throw MailServiceError.integrityConflict(
      "Approval current revision hash mismatch",
    );
  }

  const now = new Date().toISOString();

  await assertRevisionLargeAttachmentsInspectableForApproval(
    db,
    approval.currentRevisionId,
    now,
  );
  await validateStaffApprovedSendRevision(db, actor, revision);

  const newVersion = approval.workflowVersion + 1;
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const sendOperation = buildSendOperationCreation(db, actor, {
    revision,
    authorizationMode: "staff_approved",
    approvalId: approval.id,
    idempotencyKey: buildApprovedSendIdempotencyKey(approval.id),
  });

  const postState: ApprovalPostStateGuard = {
    approvalId: approval.id,
    revisionChainId: approval.revisionChainId,
    workflowVersion: newVersion,
    status: "approved",
    currentRevisionId: approval.currentRevisionId,
    currentContentHash: approval.currentContentHash,
    currentHashVersion: approval.currentHashVersion,
  };

  try {
    await runMailBatch(db, [
      db
        .update(schema.mailOutboundApprovals)
        .set({
          status: "approved",
          workflowVersion: newVersion,
          approvedRevisionId: approval.currentRevisionId,
          approvedContentHash: approval.currentContentHash,
          approvedHashVersion: approval.currentHashVersion,
          resolvedByUserId: actor.userId,
          resolvedAt: now,
          nextReminderAt: null,
        })
        .where(
          and(
            eq(schema.mailOutboundApprovals.id, approval.id),
            eq(
              schema.mailOutboundApprovals.workflowVersion,
              approval.workflowVersion,
            ),
            eq(schema.mailOutboundApprovals.status, "pending"),
            eq(
              schema.mailOutboundApprovals.currentRevisionId,
              approval.currentRevisionId,
            ),
            eq(
              schema.mailOutboundApprovals.currentContentHash,
              approval.currentContentHash,
            ),
            eq(
              schema.mailOutboundApprovals.currentHashVersion,
              approval.currentHashVersion,
            ),
          ),
        ),
      buildApprovalTransitionGuardedEventInsert(db, postState, {
        eventId,
        eventType: "approved",
        revisionId: approval.currentRevisionId,
        contentHash: approval.currentContentHash,
        hashVersion: approval.currentHashVersion,
        actorUserId: actor.userId,
        now,
      }),
      buildApprovalPostStateGuardedAuditInsert(db, actor, postState, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.approvalApproved,
        entityId: approval.id,
        metadata: {
          approvalId: approval.id,
          revisionChainId: approval.revisionChainId,
          revisionId: approval.currentRevisionId,
          contentHash: approval.currentContentHash,
          hashVersion: approval.currentHashVersion,
          workflowVersion: newVersion,
          reviewerUserId: actor.userId,
          status: "approved",
        },
      }),
      ...sendOperation.statements,
    ]);
  } catch (error) {
    handleApprovalBatchError(error);
  }

  const updated = await findApprovalById(db, approval.id);
  if (!updated) {
    throw MailServiceError.integrityConflict("Approval approve failed");
  }
  return loadApprovalView(db, updated, true);
}

export async function getApproval(
  db: Database,
  actor: MailActorContext,
  approvalId: string,
): Promise<SafeApprovalView> {
  const approval = await findApprovalById(db, approvalId);
  if (!approval) {
    throw MailServiceError.notFound("Approval workflow not found");
  }
  await assertCanReadApproval(db, actor, approval);
  return loadApprovalView(db, approval, true);
}

export async function listApprovalsForAuthor(
  db: Database,
  actor: MailActorContext,
  input?: { status?: ApprovalListStatus },
): Promise<SafeApprovalView[]> {
  assertEffectiveMailAccess(actor);

  const conditions = [
    eq(schema.mailOutboundApprovals.requestedByUserId, actor.userId),
  ];
  if (input?.status === "all-reviewed") {
    conditions.push(
      inArray(schema.mailOutboundApprovals.status, [
        "returned",
        "withdrawn",
        "approved",
      ]),
    );
  } else if (input?.status) {
    conditions.push(eq(schema.mailOutboundApprovals.status, input.status));
  }

  const rows = await db
    .select()
    .from(schema.mailOutboundApprovals)
    .where(and(...conditions))
    .orderBy(desc(schema.mailOutboundApprovals.requestedAt));

  const [revisionSummaries, eventsByApprovalId] = await Promise.all([
    loadApprovalRevisionSummaries(db, rows),
    loadApprovalEventsForList(db, rows),
  ]);
  return rows.map((row) =>
    toSafeApprovalView(
      row,
      eventsByApprovalId.get(row.id),
      revisionSummaries.get(row.currentRevisionId),
    ),
  );
}

export async function listApprovalsForReviewer(
  db: Database,
  actor: MailActorContext,
  input?: { status?: ApprovalListStatus },
): Promise<SafeApprovalView[]> {
  assertMailOutboundApprovalReview(actor);

  const conditions = [];
  if (input?.status === "all-reviewed") {
    conditions.push(
      inArray(schema.mailOutboundApprovals.status, [
        "returned",
        "withdrawn",
        "approved",
      ]),
    );
  } else if (input?.status) {
    conditions.push(eq(schema.mailOutboundApprovals.status, input.status));
  } else {
    conditions.push(eq(schema.mailOutboundApprovals.status, "pending"));
  }

  const rows = await db
    .select()
    .from(schema.mailOutboundApprovals)
    .where(and(...conditions))
    .orderBy(
      desc(schema.mailOutboundApprovals.priority),
      asc(schema.mailOutboundApprovals.requestedAt),
    );

  const [revisionSummaries, eventsByApprovalId] = await Promise.all([
    loadApprovalRevisionSummaries(db, rows),
    loadApprovalEventsForList(db, rows),
  ]);
  return rows.map((row) =>
    toSafeApprovalView(
      row,
      eventsByApprovalId.get(row.id),
      revisionSummaries.get(row.currentRevisionId),
    ),
  );
}
