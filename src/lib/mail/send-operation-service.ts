import { and, desc, eq, sql } from "drizzle-orm";
import type { MailOutboundApproval } from "../../../drizzle/schema/mail-outbound-approvals";
import type { MailOutboundRevision } from "../../../drizzle/schema/mail-outbound-revisions";
import type { MailSendOperation } from "../../../drizzle/schema/mail-send-operations";
import type { MailTransportAttempt } from "../../../drizzle/schema/mail-transport-attempts";
import { schema, type Database } from "@/lib/db";
import {
  resolveMailActorContext,
  type MailActorContext,
} from "@/lib/mail/actor-context";
import { assertCanComposeFromIdentityInMailbox } from "@/lib/mail/compose-authorization";
import {
  CANONICAL_CONTENT_HASH_VERSION,
  MAIL_AUDIT_ACTIONS,
} from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertBatchUpdateChanged,
  buildInvalidSendPostStateGuardedAuditInsert,
  buildRfcIdentityGuardedInsert,
  buildSendPostStateGuardedAuditInsert,
  buildTransportAttemptGuardedInsert,
  isMailPostStateGuardError,
  runMailBatch,
  type SendPostStateGuard,
} from "@/lib/mail/guarded-batch";
import { recomputeOutboundRevisionContentHash } from "@/lib/mail/outbound-revision-service";
import { generateRfcMessageId } from "@/lib/mail/rfc-message-id";
import { classifyThrownOutboundProviderDispatchError } from "@/lib/mail/outbound-provider-dispatch-classifier";
import { isRfcReplyComposeMode } from "@/lib/mail/compose-mode-threading-semantics";
import { resolveOutboundMessageThreadingFields } from "@/lib/mail/outbound-materialization-threading";
import {
  toSafeSendOperationView,
  type SafeSendOperationView,
} from "@/lib/mail/send-operation-serialization";
import { buildResolvedNotificationIntentInsert } from "@/lib/mail/notification-outbox-batch-enqueue";
import { resolveImportantSendFailureNotificationTarget } from "@/lib/mail/notification-source-recipient-resolution";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import { assertStoredFilesEligibleForSend } from "@/lib/mail/stored-file-send-eligibility";
import { runOutboundSendPreflightOrRecordBlock } from "@/lib/mail/outbound-send-preflight-service";
import { assertOutboundSendRateLimitsWithinPolicy } from "@/lib/mail/outbound-send-rate-limit";
import {
  resolveMailOutboundTransportMode,
  type MailOutboundTransportMode,
} from "@/lib/mail/outbound-transport-constants";
import type {
  MailTransportAdapter,
  NormalizedOutboundSubmission,
} from "@/lib/mail/transport/mail-transport-adapter";
import {
  assertEffectiveMailAccess,
  assertMailAccessEnabled,
  assertMailOutboundApprovalReview,
} from "@/lib/permissions/mail";

const STAFF_APPROVED_REVISION_KINDS = new Set([
  "staff_submit",
  "staff_resubmit",
  "admin_edit",
]);

type SendSemanticRequest = {
  outboundRevisionId: string;
  authorizationMode: MailSendOperation["authorizationMode"];
  approvalId: string | null;
  contentHash: string;
  hashVersion: number;
  revisionKind: MailSendOperation["revisionKind"];
};

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

async function findSendById(
  db: Database,
  sendOperationId: string,
): Promise<MailSendOperation | null> {
  const [row] = await db
    .select()
    .from(schema.mailSendOperations)
    .where(eq(schema.mailSendOperations.id, sendOperationId))
    .limit(1);
  return row ?? null;
}

async function findSendByRevisionId(
  db: Database,
  revisionId: string,
): Promise<MailSendOperation | null> {
  const [row] = await db
    .select()
    .from(schema.mailSendOperations)
    .where(eq(schema.mailSendOperations.outboundRevisionId, revisionId))
    .limit(1);
  return row ?? null;
}

async function findSendByApprovalId(
  db: Database,
  approvalId: string,
): Promise<MailSendOperation | null> {
  const [row] = await db
    .select()
    .from(schema.mailSendOperations)
    .where(eq(schema.mailSendOperations.approvalId, approvalId))
    .limit(1);
  return row ?? null;
}

async function findSendByIdempotencyKey(
  db: Database,
  idempotencyKey: string,
): Promise<MailSendOperation | null> {
  const [row] = await db
    .select()
    .from(schema.mailSendOperations)
    .where(eq(schema.mailSendOperations.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ?? null;
}

function sendSemanticFromRow(send: MailSendOperation): SendSemanticRequest {
  return {
    outboundRevisionId: send.outboundRevisionId,
    authorizationMode: send.authorizationMode,
    approvalId: send.approvalId,
    contentHash: send.contentHash,
    hashVersion: send.hashVersion,
    revisionKind: send.revisionKind,
  };
}

function assertMatchingSendSemantics(
  existing: MailSendOperation,
  requested: SendSemanticRequest,
): void {
  const existingSemantic = sendSemanticFromRow(existing);
  const keys = Object.keys(requested) as (keyof SendSemanticRequest)[];
  for (const key of keys) {
    if (existingSemantic[key] !== requested[key]) {
      throw MailServiceError.integrityConflict(
        "Idempotency key or revision send conflict — semantics differ",
        { field: key },
      );
    }
  }
}

async function assertRevisionHashIntegrity(
  db: Database,
  revision: MailOutboundRevision,
): Promise<void> {
  const recomputed = await recomputeOutboundRevisionContentHash(db, revision.id);
  if (recomputed.hashVersion !== CANONICAL_CONTENT_HASH_VERSION) {
    throw MailServiceError.integrityConflict("Unsupported hash version");
  }
  if (
    recomputed.contentHash !== revision.contentHash ||
    recomputed.hashVersion !== revision.hashVersion
  ) {
    throw MailServiceError.integrityConflict(
      "Outbound revision content hash integrity conflict",
    );
  }
}

async function resolveActorForUserId(
  db: Database,
  userId: string,
  audit: MailActorContext["audit"] = {},
): Promise<MailActorContext> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) {
    throw MailServiceError.notFound("User not found");
  }
  return resolveMailActorContext(user, { db, audit });
}

async function assertStaffAuthorSendAuthority(
  db: Database,
  revision: MailOutboundRevision,
  audit: MailActorContext["audit"],
): Promise<void> {
  const staffAuthor = await resolveActorForUserId(
    db,
    revision.createdByUserId,
    audit,
  );
  assertMailAccessEnabled(staffAuthor);
  await assertCanComposeFromIdentityInMailbox(db, staffAuthor, {
    senderIdentityId: revision.senderIdentityId,
    mailboxId: revision.mailboxId,
  });
}

async function assertAdminDirectSendAuthority(
  db: Database,
  actor: MailActorContext,
  revision: MailOutboundRevision,
): Promise<void> {
  if (actor.crmRole !== "admin") {
    throw MailServiceError.forbidden("CRM admin role required for admin_direct send");
  }
  assertEffectiveMailAccess(actor);
  await assertCanComposeFromIdentityInMailbox(db, actor, {
    senderIdentityId: revision.senderIdentityId,
    mailboxId: revision.mailboxId,
  });
}

async function loadApprovedApprovalForRevision(
  db: Database,
  revision: MailOutboundRevision,
): Promise<MailOutboundApproval> {
  const [approval] = await db
    .select()
    .from(schema.mailOutboundApprovals)
    .where(
      eq(schema.mailOutboundApprovals.revisionChainId, revision.revisionChainId),
    )
    .limit(1);

  if (!approval) {
    throw MailServiceError.notFound("Approval workflow not found");
  }
  if (approval.status !== "approved") {
    throw MailServiceError.forbidden("Approval is not approved");
  }
  if (approval.approvedRevisionId !== revision.id) {
    throw MailServiceError.forbidden(
      "Send requires the exact approved revision — not a different revision in the chain",
    );
  }
  if (
    approval.approvedContentHash !== revision.contentHash ||
    approval.approvedHashVersion !== revision.hashVersion
  ) {
    throw MailServiceError.integrityConflict(
      "Approval provenance does not match revision hash",
    );
  }
  return approval;
}

async function createSendOperationWithRfcIdentity(
  db: Database,
  actor: MailActorContext,
  input: {
    revision: MailOutboundRevision;
    authorizationMode: MailSendOperation["authorizationMode"];
    approvalId: string | null;
    idempotencyKey: string;
  },
): Promise<MailSendOperation> {
  const now = new Date().toISOString();
  const sendOperationId = crypto.randomUUID();
  const rfcIdentityId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const rfcMessageId = generateRfcMessageId();

  const sendRow = {
    id: sendOperationId,
    outboundRevisionId: input.revision.id,
    revisionChainId: input.revision.revisionChainId,
    contentHash: input.revision.contentHash,
    hashVersion: input.revision.hashVersion,
    revisionKind: input.revision.revisionKind,
    authorizationMode: input.authorizationMode,
    approvalId: input.authorizationMode === "staff_approved" ? input.approvalId : null,
    idempotencyKey: input.idempotencyKey,
    status: "pending" as const,
    orchestrationVersion: 1,
    initiatedByUserId: actor.userId,
    createdAt: now,
    completedAt: null,
    nextAttemptAt: null,
  };

  const postGuard: SendPostStateGuard = {
    sendOperationId,
    outboundRevisionId: input.revision.id,
    orchestrationVersion: 1,
    status: "pending",
  };

  try {
    await runMailBatch(db, [
      db.insert(schema.mailSendOperations).values(sendRow),
      buildRfcIdentityGuardedInsert(db, postGuard, {
        id: rfcIdentityId,
        rfcMessageId,
        now,
      }),
      buildSendPostStateGuardedAuditInsert(db, actor, postGuard, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.sendInitiated,
        entityId: sendOperationId,
        metadata: {
          outboundRevisionId: input.revision.id,
          authorizationMode: input.authorizationMode,
          approvalId: input.approvalId,
          rfcMessageId,
        },
      }),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const byRevision = await findSendByRevisionId(db, input.revision.id);
      if (byRevision) {
        assertMatchingSendSemantics(byRevision, sendSemanticFromRow({
          ...sendRow,
          approvalId: sendRow.approvalId ?? null,
        } as MailSendOperation));
        return byRevision;
      }
      const byKey = await findSendByIdempotencyKey(db, input.idempotencyKey);
      if (byKey) {
        assertMatchingSendSemantics(byKey, sendSemanticFromRow({
          ...sendRow,
          approvalId: sendRow.approvalId ?? null,
        } as MailSendOperation));
        return byKey;
      }
    }
    throw error;
  }

  const created = await findSendById(db, sendOperationId);
  if (!created) {
    throw MailServiceError.conflict("Send operation creation failed");
  }
  return created;
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

export async function initiateStaffApprovedSend(
  db: Database,
  actor: MailActorContext,
  input: { revisionId: string; idempotencyKey: string },
): Promise<SafeSendOperationView> {
  assertMailOutboundApprovalReview(actor);

  if (!input.idempotencyKey.trim()) {
    throw MailServiceError.validation("idempotencyKey is required");
  }

  const revision = await findRevisionById(db, input.revisionId);
  if (!revision) {
    throw MailServiceError.notFound("Outbound revision not found");
  }
  if (!STAFF_APPROVED_REVISION_KINDS.has(revision.revisionKind)) {
    throw MailServiceError.validation(
      "Staff approved send requires staff revision kind",
    );
  }

  await assertRevisionHashIntegrity(db, revision);
  const approval = await loadApprovedApprovalForRevision(db, revision);
  await assertStaffAuthorSendAuthority(db, revision, actor.audit);
  await assertStoredFilesEligibleForSend(db, revision.id);

  const recipientRows = await db
    .select({ id: schema.mailOutboundRevisionRecipients.id })
    .from(schema.mailOutboundRevisionRecipients)
    .where(eq(schema.mailOutboundRevisionRecipients.revisionId, revision.id));
  await assertOutboundSendRateLimitsWithinPolicy(db, actor, {
    phase: "initiate",
    recipientCount: recipientRows.length,
  });

  const existing = await findSendByRevisionId(db, revision.id);
  if (existing) {
    assertMatchingSendSemantics(existing, {
      outboundRevisionId: revision.id,
      authorizationMode: "staff_approved",
      approvalId: approval.id,
      contentHash: revision.contentHash,
      hashVersion: revision.hashVersion,
      revisionKind: revision.revisionKind,
    });
    return getSendOperation(db, actor, existing.id);
  }

  const byKey = await findSendByIdempotencyKey(db, input.idempotencyKey);
  if (byKey) {
    assertMatchingSendSemantics(byKey, {
      outboundRevisionId: revision.id,
      authorizationMode: "staff_approved",
      approvalId: approval.id,
      contentHash: revision.contentHash,
      hashVersion: revision.hashVersion,
      revisionKind: revision.revisionKind,
    });
    return getSendOperation(db, actor, byKey.id);
  }

  const send = await createSendOperationWithRfcIdentity(db, actor, {
    revision,
    authorizationMode: "staff_approved",
    approvalId: approval.id,
    idempotencyKey: input.idempotencyKey,
  });
  return getSendOperation(db, actor, send.id);
}

export function buildApprovedSendIdempotencyKey(approvalId: string): string {
  return `mail:approval:${approvalId}:send`;
}

/**
 * Enqueues an approved staff revision for future transport without dispatching.
 * Idempotent per approval/revision via deterministic idempotency key.
 */
export async function prepareApprovedOutboundSend(
  db: Database,
  actor: MailActorContext,
  input: { approvalId: string },
): Promise<SafeSendOperationView> {
  assertMailOutboundApprovalReview(actor);

  const [approval] = await db
    .select()
    .from(schema.mailOutboundApprovals)
    .where(eq(schema.mailOutboundApprovals.id, input.approvalId))
    .limit(1);
  if (!approval) {
    throw MailServiceError.notFound("Approval workflow not found");
  }
  if (approval.status !== "approved") {
    throw MailServiceError.conflict("Approval must be approved before queueing send", {
      status: approval.status,
    });
  }
  if (!approval.approvedRevisionId) {
    throw MailServiceError.integrityConflict("Approved revision reference missing");
  }

  return initiateStaffApprovedSend(db, actor, {
    revisionId: approval.approvedRevisionId,
    idempotencyKey: buildApprovedSendIdempotencyKey(approval.id),
  });
}

export async function getSendOperationForApproval(
  db: Database,
  actor: MailActorContext,
  approvalId: string,
): Promise<SafeSendOperationView | null> {
  const [approval] = await db
    .select()
    .from(schema.mailOutboundApprovals)
    .where(eq(schema.mailOutboundApprovals.id, approvalId))
    .limit(1);
  if (!approval) {
    throw MailServiceError.notFound("Approval workflow not found");
  }
  if (approval.requestedByUserId === actor.userId) {
    assertEffectiveMailAccess(actor);
  } else {
    assertMailOutboundApprovalReview(actor);
  }

  const send = await findSendByApprovalId(db, approvalId);
  if (!send) {
    return null;
  }
  return getSendOperation(db, actor, send.id);
}

export async function initiateAdminDirectSend(
  db: Database,
  actor: MailActorContext,
  input: { revisionId: string; idempotencyKey: string },
): Promise<SafeSendOperationView> {
  if (!input.idempotencyKey.trim()) {
    throw MailServiceError.validation("idempotencyKey is required");
  }

  const revision = await findRevisionById(db, input.revisionId);
  if (!revision) {
    throw MailServiceError.notFound("Outbound revision not found");
  }
  if (revision.revisionKind !== "admin_direct") {
    throw MailServiceError.forbidden(
      "admin_direct send requires revision_kind admin_direct — cannot bypass Staff approval on Staff revisions",
    );
  }
  if (revision.createdByUserId !== actor.userId) {
    throw MailServiceError.forbidden(
      "admin_direct send requires admin-owned revision provenance",
    );
  }

  await assertRevisionHashIntegrity(db, revision);
  await assertAdminDirectSendAuthority(db, actor, revision);
  await assertStoredFilesEligibleForSend(db, revision.id);

  const recipientRows = await db
    .select({ id: schema.mailOutboundRevisionRecipients.id })
    .from(schema.mailOutboundRevisionRecipients)
    .where(eq(schema.mailOutboundRevisionRecipients.revisionId, revision.id));
  await assertOutboundSendRateLimitsWithinPolicy(db, actor, {
    phase: "initiate",
    recipientCount: recipientRows.length,
  });

  const existing = await findSendByRevisionId(db, revision.id);
  if (existing) {
    assertMatchingSendSemantics(existing, {
      outboundRevisionId: revision.id,
      authorizationMode: "admin_direct",
      approvalId: null,
      contentHash: revision.contentHash,
      hashVersion: revision.hashVersion,
      revisionKind: revision.revisionKind,
    });
    return getSendOperation(db, actor, existing.id);
  }

  const byKey = await findSendByIdempotencyKey(db, input.idempotencyKey);
  if (byKey) {
    assertMatchingSendSemantics(byKey, {
      outboundRevisionId: revision.id,
      authorizationMode: "admin_direct",
      approvalId: null,
      contentHash: revision.contentHash,
      hashVersion: revision.hashVersion,
      revisionKind: revision.revisionKind,
    });
    return getSendOperation(db, actor, byKey.id);
  }

  const send = await createSendOperationWithRfcIdentity(db, actor, {
    revision,
    authorizationMode: "admin_direct",
    approvalId: null,
    idempotencyKey: input.idempotencyKey,
  });
  return getSendOperation(db, actor, send.id);
}

export async function getSendOperation(
  db: Database,
  actor: MailActorContext,
  sendOperationId: string,
): Promise<SafeSendOperationView> {
  assertEffectiveMailAccess(actor);

  const send = await findSendById(db, sendOperationId);
  if (!send) {
    throw MailServiceError.notFound("Send operation not found");
  }

  const [rfcIdentity] = await db
    .select()
    .from(schema.mailOutboundRfcIdentities)
    .where(eq(schema.mailOutboundRfcIdentities.sendOperationId, send.id))
    .limit(1);

  const attempts = await db
    .select()
    .from(schema.mailTransportAttempts)
    .where(eq(schema.mailTransportAttempts.sendOperationId, send.id))
    .orderBy(schema.mailTransportAttempts.attemptNumber);

  return toSafeSendOperationView(send, {
    rfcIdentity: rfcIdentity ?? null,
    transportAttempts: attempts,
  });
}

async function loadLatestAttempt(
  db: Database,
  sendOperationId: string,
): Promise<MailTransportAttempt | null> {
  const [attempt] = await db
    .select()
    .from(schema.mailTransportAttempts)
    .where(eq(schema.mailTransportAttempts.sendOperationId, sendOperationId))
    .orderBy(desc(schema.mailTransportAttempts.attemptNumber))
    .limit(1);
  return attempt ?? null;
}

async function loadStartedAttempt(
  db: Database,
  sendOperationId: string,
): Promise<MailTransportAttempt | null> {
  const [attempt] = await db
    .select()
    .from(schema.mailTransportAttempts)
    .where(
      and(
        eq(schema.mailTransportAttempts.sendOperationId, sendOperationId),
        eq(schema.mailTransportAttempts.state, "started"),
      ),
    )
    .limit(1);
  return attempt ?? null;
}

async function nextAttemptNumber(
  db: Database,
  sendOperationId: string,
): Promise<number> {
  const [row] = await db
    .select({
      maxAttempt: sql<number>`COALESCE(MAX(${schema.mailTransportAttempts.attemptNumber}), 0)`,
    })
    .from(schema.mailTransportAttempts)
    .where(eq(schema.mailTransportAttempts.sendOperationId, sendOperationId));
  return (row?.maxAttempt ?? 0) + 1;
}

async function buildNormalizedSubmission(
  db: Database,
  send: MailSendOperation,
  transportAttemptId: string,
): Promise<NormalizedOutboundSubmission> {
  const revision = await findRevisionById(db, send.outboundRevisionId);
  if (!revision) {
    throw MailServiceError.notFound("Outbound revision not found");
  }

  const [rfcIdentity] = await db
    .select()
    .from(schema.mailOutboundRfcIdentities)
    .where(eq(schema.mailOutboundRfcIdentities.sendOperationId, send.id))
    .limit(1);
  if (!rfcIdentity) {
    throw MailServiceError.integrityConflict(
      "Send operation missing stable RFC Message-ID",
    );
  }

  const recipients = await db
    .select()
    .from(schema.mailOutboundRevisionRecipients)
    .where(
      eq(schema.mailOutboundRevisionRecipients.revisionId, revision.id),
    );

  const attachments = await db
    .select()
    .from(schema.mailOutboundRevisionAttachments)
    .where(
      eq(schema.mailOutboundRevisionAttachments.revisionId, revision.id),
    )
    .orderBy(schema.mailOutboundRevisionAttachments.sortOrder);

  const [snapshot] = await db
    .select()
    .from(schema.mailSignatureSnapshots)
    .where(eq(schema.mailSignatureSnapshots.id, revision.signatureSnapshotId))
    .limit(1);
  if (!snapshot) {
    throw MailServiceError.integrityConflict("Signature snapshot missing");
  }

  const snapshotAssets = await db
    .select()
    .from(schema.mailSignatureSnapshotAssets)
    .where(
      eq(
        schema.mailSignatureSnapshotAssets.signatureSnapshotId,
        snapshot.id,
      ),
    )
    .orderBy(schema.mailSignatureSnapshotAssets.sortOrder);

  const threadingFields = await resolveOutboundMessageThreadingFields(db, {
    composeMode: revision.composeMode,
    sourceMessageId: isRfcReplyComposeMode(revision.composeMode)
      ? revision.replyToMessageId
      : null,
    outboundRfcMessageId: rfcIdentity.rfcMessageId,
  });

  return {
    sendOperationId: send.id,
    transportAttemptId,
    outboundRevisionId: revision.id,
    rfcMessageId: rfcIdentity.rfcMessageId,
    fromAddress: revision.fromAddress,
    fromDisplayName: revision.fromDisplayName,
    subject: revision.subject,
    bodyText: revision.bodyText,
    bodyHtmlSanitized: revision.bodyHtmlSanitized,
    signatureBodyText: snapshot.bodyText,
    signatureBodyHtmlSanitized: snapshot.bodyHtmlSanitized,
    signatureAssets: snapshotAssets.map((asset) => ({
      assetRef: asset.assetRef,
      storedFileId: asset.storedFileId,
      contentHash: asset.contentHash,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      sortOrder: asset.sortOrder,
    })),
    recipients: recipients.map((recipient) => ({
      type: recipient.recipientType,
      address: recipient.address,
      displayName: recipient.displayName,
    })),
    attachments: attachments.map((attachment) => ({
      revisionAttachmentId: attachment.id,
      storedFileId: attachment.storedFileId,
      contentHash: attachment.contentHash,
      displayFilename: attachment.displayFilename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sortOrder: attachment.sortOrder,
      deliveryMode: attachment.deliveryMode,
      secureExpiryDays: attachment.secureExpiryDays,
    })),
    inReplyTo: threadingFields.inReplyTo,
    referencesHeader: threadingFields.referencesHeader,
  };
}

async function claimDispatchAttempt(
  db: Database,
  actor: MailActorContext,
  send: MailSendOperation,
  adapter: MailTransportAdapter,
  transportMode: MailOutboundTransportMode,
): Promise<{ attempt: MailTransportAttempt; postGuard: SendPostStateGuard }> {
  if (send.status !== "pending") {
    throw MailServiceError.conflict(
      `Send operation must be pending to dispatch (current: ${send.status})`,
    );
  }

  const started = await loadStartedAttempt(db, send.id);
  if (started) {
    throw MailServiceError.conflict(
      "Ambiguous or in-flight started transport attempt exists — automatic retry blocked",
    );
  }

  const revision = await findRevisionById(db, send.outboundRevisionId);
  if (!revision) {
    throw MailServiceError.notFound("Outbound revision not found");
  }
  await runOutboundSendPreflightOrRecordBlock({
    db,
    actor,
    send,
    revision,
    adapterProviderId: adapter.providerId,
    transportMode,
  });

  const now = new Date().toISOString();
  const attemptId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const attemptNumber = await nextAttemptNumber(db, send.id);
  const expectedVersion = send.orchestrationVersion;
  const postVersion = expectedVersion + 1;

  const postGuard: SendPostStateGuard = {
    sendOperationId: send.id,
    outboundRevisionId: send.outboundRevisionId,
    orchestrationVersion: postVersion,
    status: "processing",
  };

  const results = await runMailBatch(db, [
    db
      .update(schema.mailSendOperations)
      .set({
        status: "processing",
        orchestrationVersion: postVersion,
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(schema.mailSendOperations.id, send.id),
          eq(schema.mailSendOperations.orchestrationVersion, expectedVersion),
          eq(schema.mailSendOperations.status, "pending"),
        ),
      ),
    buildTransportAttemptGuardedInsert(db, postGuard, {
      id: attemptId,
      attemptNumber,
      provider: adapter.providerId,
      now,
    }),
    buildSendPostStateGuardedAuditInsert(db, actor, postGuard, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.sendDispatchStarted,
      entityId: send.id,
      metadata: {
        transportAttemptId: attemptId,
        attemptNumber,
        provider: adapter.providerId,
        transportMode,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Send dispatch claim stale or conflict");

  const attempt = await db
    .select()
    .from(schema.mailTransportAttempts)
    .where(eq(schema.mailTransportAttempts.id, attemptId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!attempt) {
    throw MailServiceError.conflict("Transport attempt not created after dispatch claim");
  }

  return { attempt, postGuard };
}

async function finalizeAttemptAccepted(
  db: Database,
  actor: MailActorContext,
  send: MailSendOperation,
  attempt: MailTransportAttempt,
  result: {
    providerRequestId: string;
    providerMessageId: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const expectedVersion = send.orchestrationVersion;
  const postVersion = expectedVersion + 1;
  const auditId = crypto.randomUUID();

  const postGuard: SendPostStateGuard = {
    sendOperationId: send.id,
    outboundRevisionId: send.outboundRevisionId,
    orchestrationVersion: postVersion,
    status: "accepted",
  };

  const results = await runMailBatch(db, [
    db
      .update(schema.mailTransportAttempts)
      .set({
        state: "accepted",
        completedAt: now,
        providerRequestId: result.providerRequestId,
        providerMessageId: result.providerMessageId,
      })
      .where(
        and(
          eq(schema.mailTransportAttempts.id, attempt.id),
          eq(schema.mailTransportAttempts.state, "started"),
          eq(schema.mailTransportAttempts.sendOperationId, send.id),
        ),
      ),
    db
      .update(schema.mailSendOperations)
      .set({
        status: "accepted",
        completedAt: now,
        orchestrationVersion: postVersion,
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(schema.mailSendOperations.id, send.id),
          eq(schema.mailSendOperations.orchestrationVersion, expectedVersion),
          eq(schema.mailSendOperations.status, "processing"),
        ),
      ),
    buildSendPostStateGuardedAuditInsert(db, actor, postGuard, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.sendAccepted,
      entityId: send.id,
      metadata: {
        transportAttemptId: attempt.id,
        providerRequestId: result.providerRequestId,
        providerMessageId: result.providerMessageId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Attempt finalize accepted — attempt stale");
  assertBatchUpdateChanged(results, 1, "Attempt finalize accepted — send stale");
}

async function finalizeAttemptTemporaryFailure(
  db: Database,
  actor: MailActorContext,
  send: MailSendOperation,
  attempt: MailTransportAttempt,
  result: {
    errorCode?: string;
    errorMessage?: string;
    retryAfterAt?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const expectedVersion = send.orchestrationVersion;
  const postVersion = expectedVersion + 1;
  const auditId = crypto.randomUUID();

  const postGuard: SendPostStateGuard = {
    sendOperationId: send.id,
    outboundRevisionId: send.outboundRevisionId,
    orchestrationVersion: postVersion,
    status: "pending",
  };

  const results = await runMailBatch(db, [
    db
      .update(schema.mailTransportAttempts)
      .set({
        state: "temporary_failure",
        completedAt: now,
        retryAfterAt: result.retryAfterAt ?? null,
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
      })
      .where(
        and(
          eq(schema.mailTransportAttempts.id, attempt.id),
          eq(schema.mailTransportAttempts.state, "started"),
          eq(schema.mailTransportAttempts.sendOperationId, send.id),
        ),
      ),
    db
      .update(schema.mailSendOperations)
      .set({
        status: "pending",
        orchestrationVersion: postVersion,
        nextAttemptAt: result.retryAfterAt ?? null,
        completedAt: null,
      })
      .where(
        and(
          eq(schema.mailSendOperations.id, send.id),
          eq(schema.mailSendOperations.orchestrationVersion, expectedVersion),
          eq(schema.mailSendOperations.status, "processing"),
        ),
      ),
    buildSendPostStateGuardedAuditInsert(db, actor, postGuard, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.sendTemporaryFailure,
      entityId: send.id,
      metadata: {
        transportAttemptId: attempt.id,
        errorCode: result.errorCode ?? null,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Attempt finalize temporary — attempt stale");
  assertBatchUpdateChanged(results, 1, "Attempt finalize temporary — send stale");
}

async function finalizeAttemptPermanentFailure(
  db: Database,
  actor: MailActorContext,
  send: MailSendOperation,
  attempt: MailTransportAttempt,
  result: { errorCode?: string; errorMessage?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const expectedVersion = send.orchestrationVersion;
  const postVersion = expectedVersion + 1;
  const auditId = crypto.randomUUID();

  const postGuard: SendPostStateGuard = {
    sendOperationId: send.id,
    outboundRevisionId: send.outboundRevisionId,
    orchestrationVersion: postVersion,
    status: "failed",
  };

  const notificationTarget = await resolveImportantSendFailureNotificationTarget(
    db,
    {
      sendOperationId: send.id,
      initiatedByUserId: send.initiatedByUserId,
    },
  );

  const batchStatements: Parameters<typeof runMailBatch>[1] = [
    db
      .update(schema.mailTransportAttempts)
      .set({
        state: "permanent_failure",
        completedAt: now,
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
      })
      .where(
        and(
          eq(schema.mailTransportAttempts.id, attempt.id),
          eq(schema.mailTransportAttempts.state, "started"),
          eq(schema.mailTransportAttempts.sendOperationId, send.id),
        ),
      ),
    db
      .update(schema.mailSendOperations)
      .set({
        status: "failed",
        completedAt: now,
        orchestrationVersion: postVersion,
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(schema.mailSendOperations.id, send.id),
          eq(schema.mailSendOperations.orchestrationVersion, expectedVersion),
          eq(schema.mailSendOperations.status, "processing"),
        ),
      ),
  ];

  if (notificationTarget) {
    batchStatements.push(
      buildResolvedNotificationIntentInsert(db, {
        target: notificationTarget,
        notificationType: "important_send_failure",
        sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailSendOperation,
        sourceEntityId: send.id,
        now,
      }),
    );
  }

  batchStatements.push(
    buildSendPostStateGuardedAuditInsert(db, actor, postGuard, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.sendPermanentFailure,
      entityId: send.id,
      metadata: {
        transportAttemptId: attempt.id,
        errorCode: result.errorCode ?? null,
      },
    }),
  );

  const results = await runMailBatch(db, batchStatements);

  assertBatchUpdateChanged(results, 0, "Attempt finalize permanent — attempt stale");
  assertBatchUpdateChanged(results, 1, "Attempt finalize permanent — send stale");
}

async function finalizeAttemptAmbiguous(
  db: Database,
  actor: MailActorContext,
  send: MailSendOperation,
  attempt: MailTransportAttempt,
  result: { errorCode?: string; errorMessage?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const expectedVersion = send.orchestrationVersion;
  const postVersion = expectedVersion + 1;
  const auditId = crypto.randomUUID();

  const postGuard: SendPostStateGuard = {
    sendOperationId: send.id,
    outboundRevisionId: send.outboundRevisionId,
    orchestrationVersion: postVersion,
    status: "dispatch_uncertain",
  };

  const results = await runMailBatch(db, [
    db
      .update(schema.mailTransportAttempts)
      .set({
        state: "ambiguous",
        completedAt: now,
        providerRequestId: null,
        providerMessageId: null,
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
      })
      .where(
        and(
          eq(schema.mailTransportAttempts.id, attempt.id),
          eq(schema.mailTransportAttempts.state, "started"),
          eq(schema.mailTransportAttempts.sendOperationId, send.id),
        ),
      ),
    db
      .update(schema.mailSendOperations)
      .set({
        status: "dispatch_uncertain",
        completedAt: now,
        orchestrationVersion: postVersion,
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(schema.mailSendOperations.id, send.id),
          eq(schema.mailSendOperations.orchestrationVersion, expectedVersion),
          eq(schema.mailSendOperations.status, "processing"),
        ),
      ),
    buildSendPostStateGuardedAuditInsert(db, actor, postGuard, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.sendDispatchUncertain,
      entityId: send.id,
      metadata: {
        transportAttemptId: attempt.id,
        provider: attempt.provider,
        errorCode: result.errorCode ?? null,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Attempt finalize ambiguous — attempt stale");
  assertBatchUpdateChanged(results, 1, "Attempt finalize ambiguous — send stale");
}

/**
 * Internal provider dispatch orchestration — not exposed with fake adapter controls via HTTP.
 */
export async function dispatchSendOperation(
  db: Database,
  actor: MailActorContext,
  input: {
    sendOperationId: string;
    expectedOrchestrationVersion: number;
    adapter: MailTransportAdapter;
    transportMode?: MailOutboundTransportMode;
  },
): Promise<SafeSendOperationView> {
  assertEffectiveMailAccess(actor);

  const transportMode =
    input.transportMode ?? resolveMailOutboundTransportMode(process.env);

  const send = await findSendById(db, input.sendOperationId);
  if (!send) {
    throw MailServiceError.notFound("Send operation not found");
  }
  if (send.orchestrationVersion !== input.expectedOrchestrationVersion) {
    throw MailServiceError.staleVersion("Send orchestration version mismatch");
  }
  if (send.status === "accepted" || send.status === "failed" || send.status === "dispatch_uncertain") {
    throw MailServiceError.conflict(`Send operation is terminal (${send.status})`);
  }

  const { attempt } = await claimDispatchAttempt(
    db,
    actor,
    send,
    input.adapter,
    transportMode,
  );

  const refreshedSend = await findSendById(db, send.id);
  if (!refreshedSend) {
    throw MailServiceError.notFound("Send operation not found");
  }

  const submission = await buildNormalizedSubmission(db, refreshedSend, attempt.id);

  try {
    const result = await input.adapter.submitOutbound(submission);
    const latestSend = await findSendById(db, send.id);
    if (!latestSend) {
      throw MailServiceError.notFound("Send operation not found");
    }

    if (result.outcome === "accepted") {
      await finalizeAttemptAccepted(db, actor, latestSend, attempt, {
        providerRequestId: result.providerRequestId,
        providerMessageId: result.providerMessageId,
      });
    } else if (result.outcome === "temporary_failure") {
      await finalizeAttemptTemporaryFailure(db, actor, latestSend, attempt, {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        retryAfterAt: result.retryAfterAt,
      });
    } else if (result.outcome === "ambiguous") {
      await finalizeAttemptAmbiguous(db, actor, latestSend, attempt, {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
    } else {
      await finalizeAttemptPermanentFailure(db, actor, latestSend, attempt, {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
    }
  } catch (error) {
    if (error instanceof MailServiceError) {
      throw error;
    }
    const latestSend = await findSendById(db, send.id);
    if (!latestSend) {
      throw MailServiceError.notFound("Send operation not found");
    }
    const classification = classifyThrownOutboundProviderDispatchError(error);
    await finalizeAttemptAmbiguous(db, actor, latestSend, attempt, classification);
  }

  return getSendOperation(db, actor, send.id);
}

export async function retrySendOperation(
  db: Database,
  actor: MailActorContext,
  input: {
    sendOperationId: string;
    expectedOrchestrationVersion: number;
    adapter: MailTransportAdapter;
  },
): Promise<SafeSendOperationView> {
  assertEffectiveMailAccess(actor);

  const send = await findSendById(db, input.sendOperationId);
  if (!send) {
    throw MailServiceError.notFound("Send operation not found");
  }
  if (send.orchestrationVersion !== input.expectedOrchestrationVersion) {
    throw MailServiceError.staleVersion("Send orchestration version mismatch");
  }
  if (send.status === "dispatch_uncertain") {
    throw MailServiceError.ambiguousProviderState(
      "Ambiguous provider state requires admin review before any resend",
      { sendOperationId: send.id },
    );
  }
  if (send.status !== "pending") {
    throw MailServiceError.conflict(
      "Retry requires pending send status after explicit temporary failure",
    );
  }

  const started = await loadStartedAttempt(db, send.id);
  if (started) {
    throw MailServiceError.conflict(
      "Ambiguous started transport attempt exists — automatic retry blocked",
    );
  }

  const latestAttempt = await loadLatestAttempt(db, send.id);
  if (!latestAttempt || latestAttempt.state !== "temporary_failure") {
    throw MailServiceError.conflict(
      "Retry requires latest transport attempt to be temporary_failure",
    );
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  await runMailBatch(db, [
    buildSendPostStateGuardedAuditInsert(db, actor, {
      sendOperationId: send.id,
      outboundRevisionId: send.outboundRevisionId,
      orchestrationVersion: send.orchestrationVersion,
      status: "pending",
    }, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.sendRetryStarted,
      entityId: send.id,
      metadata: {
        priorAttemptId: latestAttempt.id,
        priorAttemptNumber: latestAttempt.attemptNumber,
      },
    }),
  ]);

  return dispatchSendOperation(db, actor, {
    sendOperationId: send.id,
    expectedOrchestrationVersion: send.orchestrationVersion,
    adapter: input.adapter,
  });
}

/** Test-only helper to exercise guarded batch rollback semantics. */
export async function attemptInvalidDispatchClaimBatch(
  db: Database,
  actor: MailActorContext,
  send: MailSendOperation,
): Promise<void> {
  const now = new Date().toISOString();
  const attemptId = crypto.randomUUID();
  const expectedVersion = send.orchestrationVersion;
  const postVersion = expectedVersion + 1;
  const postGuard: SendPostStateGuard = {
    sendOperationId: send.id,
    outboundRevisionId: send.outboundRevisionId,
    orchestrationVersion: postVersion,
    status: "processing",
  };

  await runMailBatch(db, [
    db
      .update(schema.mailSendOperations)
      .set({
        status: "processing",
        orchestrationVersion: postVersion,
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(schema.mailSendOperations.id, send.id),
          eq(schema.mailSendOperations.orchestrationVersion, expectedVersion),
          eq(schema.mailSendOperations.status, "pending"),
        ),
      ),
    buildTransportAttemptGuardedInsert(db, postGuard, {
      id: attemptId,
      attemptNumber: 1,
      provider: "fake-local",
      now,
    }),
    buildInvalidSendPostStateGuardedAuditInsert(db, actor, {
      auditId: crypto.randomUUID(),
      now,
      action: MAIL_AUDIT_ACTIONS.sendDispatchStarted,
      entityId: send.id,
      metadata: {},
    }),
  ]);
}

/** Test hooks — only when CRM_ALLOW_TEST_DB_BIND=1. */
export const sendOperationTestHooks =
  process.env.CRM_ALLOW_TEST_DB_BIND === "1"
    ? {
        finalizeAttemptAccepted,
        finalizeAttemptAmbiguous,
        claimDispatchAttempt,
        findSendById,
        loadStartedAttempt,
      }
    : undefined;
