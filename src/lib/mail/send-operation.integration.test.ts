import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  resolveMailActorContext,
  type MailActorContext,
} from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import {
  addDraftRecipient,
  createDraft,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import {
  approveRevision,
  submitRevisionForApproval,
} from "@/lib/mail/outbound-approval-service";
import { createAdminDirectRevisionFromDraft, createOutboundRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess, revokeSenderIdentityGrant } from "@/lib/mail/sender-identity-grant-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  attemptInvalidDispatchClaimBatch,
  dispatchSendOperation,
  initiateAdminDirectSend,
  initiateStaffApprovedSend,
  retrySendOperation,
  sendOperationTestHooks,
} from "@/lib/mail/send-operation-service";
import { FakeMailTransportAdapter } from "@/lib/mail/transport/fake-mail-transport-adapter";
import { isMailPostStateGuardError } from "@/lib/mail/guarded-batch";

const FIXTURE = "mail-phase2c7";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailActorContext["adminGrants"] = [],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c7-test" },
  };
}

const setupAdminActor = actor(SEED_IDS.admin, [
  "account_mgmt",
  "address_assignment",
  "signature_template",
]);
const approvalReviewActor = actor(SEED_IDS.staffB, ["approval_review"]);
const staffActor = actor(SEED_IDS.staffA, []);
const adminActor = actor(SEED_IDS.admin, []);

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

async function enableMailAccess(db: TestDb, userId: string) {
  const now = new Date().toISOString();
  await db
    .insert(schema.mailUserAccess)
    .values({
      userId,
      isEnabled: 1,
      enabledAt: now,
      enabledBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.mailUserAccess.userId,
      set: { isEnabled: 1, updatedAt: now },
    });
}

async function disableMailAccess(db: TestDb, userId: string) {
  const now = new Date().toISOString();
  await db
    .update(schema.mailUserAccess)
    .set({ isEnabled: 0, updatedAt: now })
    .where(eq(schema.mailUserAccess.userId, userId));
}

async function cleanupFixtures(db: TestDb) {
  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);

  const identities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));
  const identityIds = identities.map((row) => row.id);

  const drafts =
    identityIds.length > 0
      ? await db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.senderIdentityId, identityIds))
      : [];
  const draftIds = drafts.map((row) => row.id);

  const revisions = draftIds.length
    ? await db
        .select({
          id: schema.mailOutboundRevisions.id,
          chainId: schema.mailOutboundRevisions.revisionChainId,
        })
        .from(schema.mailOutboundRevisions)
        .where(inArray(schema.mailOutboundRevisions.sourceDraftId, draftIds))
    : [];

  const allRevisions = revisions;
  const revisionIds = allRevisions.map((row) => row.id);
  const chainIds = [...new Set(allRevisions.map((row) => row.chainId))];

  const sendOps = revisionIds.length
    ? await db
        .select({ id: schema.mailSendOperations.id })
        .from(schema.mailSendOperations)
        .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds))
    : [];
  const sendIds = sendOps.map((row) => row.id);

  if (sendIds.length) {
    await db
      .delete(schema.mailTransportAttempts)
      .where(inArray(schema.mailTransportAttempts.sendOperationId, sendIds));
    await db
      .delete(schema.mailOutboundRfcIdentities)
      .where(inArray(schema.mailOutboundRfcIdentities.sendOperationId, sendIds));
    await db
      .delete(schema.mailSendOperations)
      .where(inArray(schema.mailSendOperations.id, sendIds));
  }

  if (chainIds.length) {
    await db
      .delete(schema.mailOutboundApprovalEvents)
      .where(inArray(schema.mailOutboundApprovalEvents.revisionChainId, chainIds));
    await db
      .delete(schema.mailOutboundApprovals)
      .where(inArray(schema.mailOutboundApprovals.revisionChainId, chainIds));
  }

  const snapshots = revisionIds.length
    ? await db
        .select({ id: schema.mailOutboundRevisions.signatureSnapshotId })
        .from(schema.mailOutboundRevisions)
        .where(inArray(schema.mailOutboundRevisions.id, revisionIds))
    : [];
  const snapshotIds = snapshots.map((row) => row.id);

  if (revisionIds.length) {
    await db
      .delete(schema.mailOutboundRevisionAttachments)
      .where(inArray(schema.mailOutboundRevisionAttachments.revisionId, revisionIds));
    await db
      .delete(schema.mailOutboundRevisionRecipients)
      .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds));
    await db
      .delete(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.id, revisionIds));
  }

  if (snapshotIds.length) {
    await db
      .delete(schema.mailSignatureSnapshotAssets)
      .where(inArray(schema.mailSignatureSnapshotAssets.signatureSnapshotId, snapshotIds));
    await db
      .delete(schema.mailSignatureSnapshots)
      .where(inArray(schema.mailSignatureSnapshots.id, snapshotIds));
  }

  if (draftIds.length) {
    await db
      .delete(schema.mailDraftRecipients)
      .where(inArray(schema.mailDraftRecipients.draftId, draftIds));
    await db
      .delete(schema.mailDrafts)
      .where(inArray(schema.mailDrafts.id, draftIds));
  }

  if (identityIds.length) {
    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds));
    await db
      .delete(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.id, identityIds));
  }

  if (mailboxIds.length) {
    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));
    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, mailboxIds));
  }
}

async function setupStaffComposeFixture(db: TestDb) {
  const address = fixtureAddress("staff-compose");
  const mailbox = await createMailbox(db, setupAdminActor, {
    address,
    mailboxType: "personal",
  });
  const identity = await createSenderIdentity(db, setupAdminActor, {
    address,
    defaultMailboxId: mailbox.id,
  });
  await grantSenderIdentityAccess(db, setupAdminActor, {
    senderIdentityId: identity.id,
    targetUserId: SEED_IDS.staffA,
    canSend: true,
  });
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: `${FIXTURE}-staff-member`,
    mailboxId: mailbox.id,
    userId: SEED_IDS.staffA,
    canRead: 1,
    canReply: 1,
    canSend: 1,
    canAssign: 0,
    canManageProcessing: 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
  return { mailbox, identity };
}

async function setupAdminComposeFixture(db: TestDb) {
  const address = fixtureAddress("admin-compose");
  const mailbox = await createMailbox(db, setupAdminActor, {
    address,
    mailboxType: "personal",
  });
  const identity = await createSenderIdentity(db, setupAdminActor, {
    address,
    defaultMailboxId: mailbox.id,
  });
  await grantSenderIdentityAccess(db, setupAdminActor, {
    senderIdentityId: identity.id,
    targetUserId: SEED_IDS.admin,
    canSend: true,
  });
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: `${FIXTURE}-admin-member`,
    mailboxId: mailbox.id,
    userId: SEED_IDS.admin,
    canRead: 1,
    canReply: 1,
    canSend: 1,
    canAssign: 0,
    canManageProcessing: 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
  return { mailbox, identity };
}

async function createSendReadyDraft(
  db: TestDb,
  actorCtx: MailActorContext,
  mailboxId: string,
  identityId: string,
): Promise<DraftDetailView> {
  const created = await createDraft(db, actorCtx, {
    senderIdentityId: identityId,
    mailboxId,
    subject: "Send subject",
    bodyText: "Send body",
  });
  assert.ok(created.created);
  return addDraftRecipient(db, actorCtx, {
    draftId: created.item.id,
    expectedAutosaveVersion: created.item.autosaveVersion,
    recipientType: "to",
    address: "client@example.com",
  });
}

async function createApprovedStaffRevision(db: TestDb) {
  const { mailbox, identity } = await setupStaffComposeFixture(db);
  const draft = await createSendReadyDraft(
    db,
    staffActor,
    mailbox.id,
    identity.id,
  );
  const r1 = await createOutboundRevisionFromDraft(db, staffActor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
  });
  const approval = await submitRevisionForApproval(db, staffActor, {
    revisionId: r1.id,
  });
  const approved = await approveRevision(db, approvalReviewActor, {
    approvalId: approval.id,
    expectedWorkflowVersion: 1,
  });
  return { mailbox, identity, r1, approval: approved };
}

async function createProductionAdminDirectRevision(db: TestDb) {
  const { mailbox, identity } = await setupAdminComposeFixture(db);
  const draft = await createSendReadyDraft(db, adminActor, mailbox.id, identity.id);
  const revision = await createAdminDirectRevisionFromDraft(db, adminActor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
  });
  return { mailbox, identity, draft, revision };
}

async function assertNoMaterializationSideEffects(db: TestDb, sendId: string) {
  const materializations = await db
    .select()
    .from(schema.mailOutboundMessageMaterializations)
    .where(eq(schema.mailOutboundMessageMaterializations.sendOperationId, sendId));
  assert.equal(materializations.length, 0);

  const deliveryEvents = await db.select().from(schema.mailDeliveryEvents);
  assert.equal(deliveryEvents.length, 0);
}

describe("send operation orchestration integration", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await enableMailAccess(db, SEED_IDS.admin);
    await enableMailAccess(db, SEED_IDS.staffA);
    await enableMailAccess(db, SEED_IDS.staffB);
    await cleanupFixtures(db);
    assert.ok(sendOperationTestHooks);
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
  });

  it("staff approved basic: reviewer triggers send, fake accepted", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: `${FIXTURE}-staff-basic`,
    });
    assert.equal(initiated.authorizationMode, "staff_approved");
    assert.ok(initiated.rfcIdentity?.rfcMessageId);
    assert.equal(initiated.status, "pending");

    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "accepted",
      providerRequestId: "req-1",
      providerMessageId: "msg-1",
    });
    const dispatched = await dispatchSendOperation(db, approvalReviewActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    assert.equal(dispatched.status, "accepted");
    assert.equal(dispatched.transportAttempts?.length, 1);
    assert.equal(dispatched.transportAttempts?.[0]?.state, "accepted");
    await assertNoMaterializationSideEffects(db, initiated.id);
  });

  it("staff approval mismatch: wrong revision rejected", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupStaffComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const r1 = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: r1.id,
    });
    await approveRevision(db, approvalReviewActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });

    const draft2 = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const r2 = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft2.id,
      expectedAutosaveVersion: draft2.autosaveVersion,
    });

    await assert.rejects(
      () =>
        initiateStaffApprovedSend(db, approvalReviewActor, {
          revisionId: r2.id,
          idempotencyKey: `${FIXTURE}-wrong-rev`,
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        (error.status === 403 || error.status === 404),
    );
  });

  it("staff author grant revoked after approval blocks send", async () => {
    await cleanupFixtures(db);
    const { identity, r1 } = await createApprovedStaffRevision(db);
    const [grant] = await db
      .select()
      .from(schema.mailSenderIdentityGrants)
      .where(
        and(
          eq(schema.mailSenderIdentityGrants.senderIdentityId, identity.id),
          eq(schema.mailSenderIdentityGrants.userId, SEED_IDS.staffA),
        ),
      )
      .limit(1);
    assert.ok(grant);
    await revokeSenderIdentityGrant(db, setupAdminActor, { grantId: grant.id });

    await assert.rejects(
      () =>
        initiateStaffApprovedSend(db, approvalReviewActor, {
          revisionId: r1.id,
          idempotencyKey: `${FIXTURE}-revoked-grant`,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
  });

  it("reviewer without sender grant can release approved staff send", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: `${FIXTURE}-reviewer-no-grant`,
    });
    assert.equal(initiated.status, "pending");
  });

  it("admin_direct basic send", async () => {
    await cleanupFixtures(db);
    const { revision } = await createProductionAdminDirectRevision(db);
    assert.equal(revision.revisionKind, "admin_direct");
    assert.equal(revision.createdByUserId, SEED_IDS.admin);

    const initiated = await initiateAdminDirectSend(db, adminActor, {
      revisionId: revision.id,
      idempotencyKey: `${FIXTURE}-admin-direct`,
    });
    assert.equal(initiated.authorizationMode, "admin_direct");
    assert.equal(initiated.approvalId, null);

    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "accepted",
      providerRequestId: "admin-req",
      providerMessageId: "admin-msg",
    });
    const result = await dispatchSendOperation(db, adminActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    assert.equal(result.status, "accepted");
  });

  it("admin_direct requires sender grant and mail access", async () => {
    await cleanupFixtures(db);
    const { identity, revision } = await createProductionAdminDirectRevision(db);

    await disableMailAccess(db, SEED_IDS.admin);
    const [adminUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.admin))
      .limit(1);
    assert.ok(adminUser);
    const disabledAdminActor = await resolveMailActorContext(adminUser, { db });
    await assert.rejects(
      () =>
        initiateAdminDirectSend(db, disabledAdminActor, {
          revisionId: revision.id,
          idempotencyKey: `${FIXTURE}-admin-no-access`,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
    await enableMailAccess(db, SEED_IDS.admin);

    const [grant] = await db
      .select()
      .from(schema.mailSenderIdentityGrants)
      .where(
        and(
          eq(schema.mailSenderIdentityGrants.senderIdentityId, identity.id),
          eq(schema.mailSenderIdentityGrants.userId, SEED_IDS.admin),
        ),
      )
      .limit(1);
    assert.ok(grant);
    await revokeSenderIdentityGrant(db, setupAdminActor, { grantId: grant.id });

    await assert.rejects(
      () =>
        initiateAdminDirectSend(db, adminActor, {
          revisionId: revision.id,
          idempotencyKey: `${FIXTURE}-admin-no-grant`,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
  });

  it("admin cannot admin_direct staff revision to bypass approval", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    await assert.rejects(
      () =>
        initiateAdminDirectSend(db, adminActor, {
          revisionId: r1.id,
          idempotencyKey: `${FIXTURE}-bypass`,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
  });

  it("idempotent send initiation", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    const key = `${FIXTURE}-idem`;
    const first = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: key,
    });
    const second = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: key,
    });
    assert.equal(first.id, second.id);
  });

  it("idempotency key conflict with different semantics rejected", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupStaffComposeFixture(db);
    const draft1 = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const r1 = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft1.id,
      expectedAutosaveVersion: draft1.autosaveVersion,
    });
    const approval1 = await submitRevisionForApproval(db, staffActor, {
      revisionId: r1.id,
    });
    await approveRevision(db, approvalReviewActor, {
      approvalId: approval1.id,
      expectedWorkflowVersion: 1,
    });

    const draft2 = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const r2 = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft2.id,
      expectedAutosaveVersion: draft2.autosaveVersion,
    });
    const approval2 = await submitRevisionForApproval(db, staffActor, {
      revisionId: r2.id,
    });
    await approveRevision(db, approvalReviewActor, {
      approvalId: approval2.id,
      expectedWorkflowVersion: 1,
    });

    const sharedKey = `${FIXTURE}-shared-key`;
    await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: sharedKey,
    });

    await assert.rejects(
      () =>
        initiateStaffApprovedSend(db, approvalReviewActor, {
          revisionId: r2.id,
          idempotencyKey: sharedKey,
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "INTEGRITY_CONFLICT",
    );
  });

  it("concurrent dispatch: only one started attempt", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: `${FIXTURE}-concurrent`,
    });
    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "accepted",
      providerRequestId: "c-req",
      providerMessageId: "c-msg",
    });

    const results = await Promise.allSettled([
      dispatchSendOperation(db, approvalReviewActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter,
      }),
      dispatchSendOperation(db, approvalReviewActor, {
        sendOperationId: initiated.id,
        expectedOrchestrationVersion: initiated.orchestrationVersion,
        adapter: new FakeMailTransportAdapter().setBehavior({
          outcome: "accepted",
          providerRequestId: "c2",
          providerMessageId: "m2",
        }),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const started = await db
      .select()
      .from(schema.mailTransportAttempts)
      .where(
        and(
          eq(schema.mailTransportAttempts.sendOperationId, initiated.id),
          eq(schema.mailTransportAttempts.state, "started"),
        ),
      );
    assert.equal(started.length, 0);
  });

  it("batch rollback: invalid guarded audit rolls back dispatch claim", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: `${FIXTURE}-rollback`,
    });
    const send = await db
      .select()
      .from(schema.mailSendOperations)
      .where(eq(schema.mailSendOperations.id, initiated.id))
      .limit(1)
      .then((rows) => rows[0]);
    assert.ok(send);

    await assert.rejects(
      () => attemptInvalidDispatchClaimBatch(db, approvalReviewActor, send),
      (error: unknown) => isMailPostStateGuardError(error),
    );

    const refreshed = await db
      .select()
      .from(schema.mailSendOperations)
      .where(eq(schema.mailSendOperations.id, initiated.id))
      .limit(1)
      .then((rows) => rows[0]);
    assert.equal(refreshed?.status, "pending");
    assert.equal(refreshed?.orchestrationVersion, 1);

    const attempts = await db
      .select()
      .from(schema.mailTransportAttempts)
      .where(eq(schema.mailTransportAttempts.sendOperationId, initiated.id));
    assert.equal(attempts.length, 0);
  });

  it("ambiguous adapter throw leaves started attempt; retry blocked", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: `${FIXTURE}-ambiguous`,
    });
    const adapter = new FakeMailTransportAdapter().setBehavior("throw");
    const result = await dispatchSendOperation(db, approvalReviewActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    assert.equal(result.status, "processing");
    assert.equal(result.transportAttempts?.[0]?.state, "started");

    await assert.rejects(
      () =>
        retrySendOperation(db, approvalReviewActor, {
          sendOperationId: initiated.id,
          expectedOrchestrationVersion: result.orchestrationVersion,
          adapter: new FakeMailTransportAdapter(),
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 409,
    );
  });

  it("temporary failure retry reuses RFC Message-ID", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: `${FIXTURE}-temp-retry`,
    });
    const rfcBefore = initiated.rfcIdentity?.rfcMessageId;
    assert.ok(rfcBefore);

    const adapter = new FakeMailTransportAdapter()
      .queueBehavior({ outcome: "temporary_failure", errorCode: "TEMP" })
      .queueBehavior({
        outcome: "accepted",
        providerRequestId: "retry-req",
        providerMessageId: "retry-msg",
      });

    const afterTemp = await dispatchSendOperation(db, approvalReviewActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    assert.equal(afterTemp.status, "pending");
    assert.equal(afterTemp.transportAttempts?.length, 1);
    assert.equal(afterTemp.transportAttempts?.[0]?.state, "temporary_failure");

    const afterRetry = await retrySendOperation(db, approvalReviewActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: afterTemp.orchestrationVersion,
      adapter,
    });
    assert.equal(afterRetry.status, "accepted");
    assert.equal(afterRetry.transportAttempts?.length, 2);
    assert.equal(afterRetry.rfcIdentity?.rfcMessageId, rfcBefore);
    assert.notEqual(
      afterRetry.transportAttempts?.[0]?.id,
      afterRetry.transportAttempts?.[1]?.id,
    );
  });

  it("permanent failure blocks retry", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: `${FIXTURE}-perm`,
    });
    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "permanent_failure",
      errorCode: "PERM",
    });
    const failed = await dispatchSendOperation(db, approvalReviewActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    assert.equal(failed.status, "failed");

    await assert.rejects(
      () =>
        retrySendOperation(db, approvalReviewActor, {
          sendOperationId: initiated.id,
          expectedOrchestrationVersion: failed.orchestrationVersion,
          adapter: new FakeMailTransportAdapter(),
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 409,
    );
  });

  it("stale finalization rejected", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: `${FIXTURE}-stale-finalize`,
    });
    const adapter = new FakeMailTransportAdapter();
    const hooks = sendOperationTestHooks!;
    const send = await hooks.findSendById(db, initiated.id);
    assert.ok(send);
    const { attempt } = await hooks.claimDispatchAttempt(
      db,
      approvalReviewActor,
      send,
      adapter,
    );
    const processingSend = await hooks.findSendById(db, initiated.id);
    assert.ok(processingSend);

    await db
      .update(schema.mailSendOperations)
      .set({
        status: "pending",
        orchestrationVersion: processingSend.orchestrationVersion + 1,
        completedAt: null,
      })
      .where(eq(schema.mailSendOperations.id, initiated.id));

    await assert.rejects(
      () =>
        hooks.finalizeAttemptAccepted(db, approvalReviewActor, processingSend, attempt, {
          providerRequestId: "stale",
          providerMessageId: "stale",
        }),
      (error: unknown) =>
        (error instanceof MailServiceError &&
          error.errorCode === "STALE_VERSION") ||
        isMailPostStateGuardError(error),
    );
  });

  it("audit actions recorded for successful send lifecycle", async () => {
    await cleanupFixtures(db);
    const { r1 } = await createApprovedStaffRevision(db);
    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: r1.id,
      idempotencyKey: `${FIXTURE}-audit`,
    });
    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "accepted",
      providerRequestId: "audit-req",
      providerMessageId: "audit-msg",
    });
    await dispatchSendOperation(db, approvalReviewActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });

    const audits = await db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, initiated.id));
    const actions = audits.map((row) => row.action);
    assert.ok(actions.includes(MAIL_AUDIT_ACTIONS.sendInitiated));
    assert.ok(actions.includes(MAIL_AUDIT_ACTIONS.sendDispatchStarted));
    assert.ok(actions.includes(MAIL_AUDIT_ACTIONS.sendAccepted));
  });
});
