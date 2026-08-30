import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import {
  addDraftRecipient,
  createDraft,
  updateDraft,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import {
  buildApprovalPostStateGuardedAuditInsert,
  buildApprovalTransitionGuardedEventInsert,
  runMailBatch,
  type ApprovalPostStateGuard,
} from "@/lib/mail/guarded-batch";
import { createMailbox } from "@/lib/mail/mailbox-service";
import {
  approveRevision,
  getApproval,
  listApprovalsForAuthor,
  listApprovalsForReviewer,
  resubmitRevisionForApproval,
  returnApproval,
  submitRevisionForApproval,
  withdrawApproval,
} from "@/lib/mail/outbound-approval-service";
import { createOutboundRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import {
  grantMailAdminPermission,
  revokeMailAdminGrant,
} from "@/lib/mail/mail-admin-grant-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";

const FIXTURE = "mail-phase2c6";

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
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c6-test" },
  };
}

const setupAdminActor = actor(SEED_IDS.admin, [
  "account_mgmt",
  "address_assignment",
  "signature_template",
]);
const superAdminActor = actor(SEED_IDS.admin, ["super_admin"]);
const approvalReviewActor = actor(SEED_IDS.staffB, ["approval_review"]);
const permissionMgmtActor = actor(SEED_IDS.admin, ["permission_mgmt"]);
const reviewerActor = approvalReviewActor;
const staffActor = actor(SEED_IDS.staffA, []);
const staffBActor = actor(SEED_IDS.staffB, []);
const globalReadActor = actor(SEED_IDS.admin, ["global_mail_read"]);

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
        .select({ id: schema.mailOutboundRevisions.id, chainId: schema.mailOutboundRevisions.revisionChainId })
        .from(schema.mailOutboundRevisions)
        .where(inArray(schema.mailOutboundRevisions.sourceDraftId, draftIds))
    : [];
  const revisionIds = revisions.map((row) => row.id);
  const chainIds = [...new Set(revisions.map((row) => row.chainId))];

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
      .delete(schema.mailDraftAttachments)
      .where(inArray(schema.mailDraftAttachments.draftId, draftIds));
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

  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.entityId, `${FIXTURE}%`));
}

async function setupComposeFixture(db: TestDb) {
  const address = fixtureAddress("compose");
  const mailbox = await createMailbox(db, setupAdminActor, {
    address,
    mailboxType: "personal",
    ownerUserId: SEED_IDS.staffA,
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
    id: `${FIXTURE}-member`,
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

async function createSendReadyDraft(
  db: TestDb,
  actor: MailActorContext,
  mailboxId: string,
  identityId: string,
  overrides?: { subject?: string; bodyText?: string },
): Promise<DraftDetailView> {
  const created = await createDraft(db, actor, {
    senderIdentityId: identityId,
    mailboxId,
    subject: overrides?.subject ?? "Approval subject",
    bodyText: overrides?.bodyText ?? "Approval body",
  });
  assert.ok(created.created);
  return addDraftRecipient(db, actor, {
    draftId: created.item.id,
    expectedAutosaveVersion: created.item.autosaveVersion,
    recipientType: "to",
    address: "client@example.com",
  });
}

async function createRevisionFromDraft(
  db: TestDb,
  actor: MailActorContext,
  draft: DraftDetailView,
) {
  return createOutboundRevisionFromDraft(db, actor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
  });
}

describe("outbound approval workflow integration", () => {
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
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
  });

  it("basic flow: submit, return, resubmit R2, approve", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(
      db,
      staffActor,
      mailbox.id,
      identity.id,
    );
    const r1 = await createRevisionFromDraft(db, staffActor, draft);

    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: r1.id,
    });
    assert.equal(approval.status, "pending");
    assert.equal(approval.workflowVersion, 1);
    assert.equal(approval.currentRevisionId, r1.id);
    assert.equal(approval.currentContentHash, r1.contentHash);

    const returned = await returnApproval(db, reviewerActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
      note: "Please revise tone",
    });
    assert.equal(returned.status, "returned");
    assert.equal(returned.workflowVersion, 2);

    const updatedDraft = await updateDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      bodyText: "Revised approval body",
    });
    const r2 = await createRevisionFromDraft(db, staffActor, updatedDraft);
    assert.notEqual(r1.contentHash, r2.contentHash);

    const pending = await resubmitRevisionForApproval(db, staffActor, {
      approvalId: approval.id,
      revisionId: r2.id,
      expectedWorkflowVersion: 2,
    });
    assert.equal(pending.status, "pending");
    assert.equal(pending.workflowVersion, 3);
    assert.equal(pending.currentRevisionId, r2.id);

    const approved = await approveRevision(db, reviewerActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 3,
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.approvedRevisionId, r2.id);
    assert.equal(approved.approvedContentHash, r2.contentHash);
    assert.equal(approved.workflowVersion, 4);

    const [storedR1] = await db
      .select()
      .from(schema.mailOutboundRevisions)
      .where(eq(schema.mailOutboundRevisions.id, r1.id));
    assert.equal(storedR1?.subject, "Approval subject");

    const events = await db
      .select()
      .from(schema.mailOutboundApprovalEvents)
      .where(eq(schema.mailOutboundApprovalEvents.approvalId, approval.id));
    assert.equal(events.length, 4);
    assert.deepEqual(
      events.map((event) => event.eventType),
      ["submitted", "returned", "resubmitted", "approved"],
    );

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, approval.id));
    assert.equal(audits.length, 4);

    await cleanupFixtures(db);
  });

  it("idempotent submit returns existing pending approval", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const revision = await createRevisionFromDraft(db, staffActor, draft);

    const first = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });
    const second = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });
    assert.equal(first.id, second.id);
    assert.equal(second.workflowVersion, 1);

    const approvals = await db
      .select()
      .from(schema.mailOutboundApprovals)
      .where(eq(schema.mailOutboundApprovals.revisionChainId, revision.revisionChainId));
    assert.equal(approvals.length, 1);

    await cleanupFixtures(db);
  });

  it("withdraw pending approval and reject stale second withdraw", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const revision = await createRevisionFromDraft(db, staffActor, draft);
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });

    const withdrawn = await withdrawApproval(db, staffActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });
    assert.equal(withdrawn.status, "withdrawn");
    assert.equal(withdrawn.workflowVersion, 2);

    await assert.rejects(
      () =>
        withdrawApproval(db, staffActor, {
          approvalId: approval.id,
          expectedWorkflowVersion: 1,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "STALE_VERSION",
    );

    await assert.rejects(
      () =>
        approveRevision(db, reviewerActor, {
          approvalId: approval.id,
          expectedWorkflowVersion: 1,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "STALE_VERSION",
    );

    await cleanupFixtures(db);
  });

  it("rejects stale reviewer approve after return", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const revision = await createRevisionFromDraft(db, staffActor, draft);
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });

    await returnApproval(db, reviewerActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
      note: "Needs changes",
    });

    await assert.rejects(
      () =>
        approveRevision(db, reviewerActor, {
          approvalId: approval.id,
          expectedWorkflowVersion: 1,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "STALE_VERSION",
    );

    const loaded = await getApproval(db, reviewerActor, approval.id);
    assert.equal(loaded.status, "returned");
    assert.equal(loaded.workflowVersion, 2);

    const approvedEvents = await db
      .select()
      .from(schema.mailOutboundApprovalEvents)
      .where(
        and(
          eq(schema.mailOutboundApprovalEvents.approvalId, approval.id),
          eq(schema.mailOutboundApprovalEvents.eventType, "approved"),
        ),
      );
    assert.equal(approvedEvents.length, 0);

    await cleanupFixtures(db);
  });

  it("rejects stale reviewer approve after resubmit to R2", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const r1 = await createRevisionFromDraft(db, staffActor, draft);
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: r1.id,
    });

    await returnApproval(db, reviewerActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
      note: "Revise",
    });

    const updatedDraft = await updateDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      bodyText: "New body for R2",
    });
    const r2 = await createRevisionFromDraft(db, staffActor, updatedDraft);
    await resubmitRevisionForApproval(db, staffActor, {
      approvalId: approval.id,
      revisionId: r2.id,
      expectedWorkflowVersion: 2,
    });

    await assert.rejects(
      () =>
        approveRevision(db, reviewerActor, {
          approvalId: approval.id,
          expectedWorkflowVersion: 2,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "STALE_VERSION",
    );

    const loaded = await getApproval(db, reviewerActor, approval.id);
    assert.equal(loaded.status, "pending");
    assert.equal(loaded.currentRevisionId, r2.id);

    await cleanupFixtures(db);
  });

  it("rejects hash tampered revision on approve", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const revision = await createRevisionFromDraft(db, staffActor, draft);
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });

    await db
      .update(schema.mailOutboundRevisions)
      .set({ bodyText: "Tampered body" })
      .where(eq(schema.mailOutboundRevisions.id, revision.id));

    await assert.rejects(
      () =>
        approveRevision(db, reviewerActor, {
          approvalId: approval.id,
          expectedWorkflowVersion: 1,
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "INTEGRITY_CONFLICT",
    );

    const loaded = await getApproval(db, reviewerActor, approval.id);
    assert.equal(loaded.status, "pending");
    assert.equal(loaded.approvedRevisionId, null);

    await db
      .update(schema.mailOutboundRevisions)
      .set({ bodyText: "Approval body" })
      .where(eq(schema.mailOutboundRevisions.id, revision.id));

    await cleanupFixtures(db);
  });

  it("authorization matrix", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const revision = await createRevisionFromDraft(db, staffActor, draft);

    await assert.rejects(
      () =>
        submitRevisionForApproval(db, staffBActor, {
          revisionId: revision.id,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });

    await assert.rejects(
      () =>
        approveRevision(db, staffActor, {
          approvalId: approval.id,
          expectedWorkflowVersion: 1,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await assert.rejects(
      () =>
        approveRevision(db, globalReadActor, {
          approvalId: approval.id,
          expectedWorkflowVersion: 1,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    const accountMgmtReviewer = actor(SEED_IDS.admin, ["account_mgmt"]);
    await assert.rejects(
      () =>
        approveRevision(db, accountMgmtReviewer, {
          approvalId: approval.id,
          expectedWorkflowVersion: 1,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await approveRevision(db, approvalReviewActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });

    const sendOps = await db.select().from(schema.mailSendOperations);
    const relatedSendOps = sendOps.filter(
      (row) => row.outboundRevisionId === revision.id,
    );
    assert.equal(relatedSendOps.length, 1);
    assert.equal(relatedSendOps[0]?.status, "pending");
    assert.equal(relatedSendOps[0]?.authorizationMode, "staff_approved");
    assert.equal(relatedSendOps[0]?.approvalId, approval.id);

    await cleanupFixtures(db);
  });

  it("approved provenance stays frozen when new revision is created", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const r1 = await createRevisionFromDraft(db, staffActor, draft);
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: r1.id,
    });
    const approved = await approveRevision(db, reviewerActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });

    const updatedDraft = await updateDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      bodyText: "Post-approval edit",
    });
    const r2 = await createRevisionFromDraft(db, staffActor, updatedDraft);

    const loaded = await getApproval(db, staffActor, approval.id);
    assert.equal(loaded.status, "approved");
    assert.equal(loaded.approvedRevisionId, r1.id);
    assert.equal(loaded.approvedContentHash, approved.approvedContentHash);
    assert.notEqual(r2.contentHash, loaded.approvedContentHash);

    await assert.rejects(
      () =>
        resubmitRevisionForApproval(db, staffActor, {
          approvalId: approval.id,
          revisionId: r2.id,
          expectedWorkflowVersion: loaded.workflowVersion,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );

    await cleanupFixtures(db);
  });

  it("rolls back approval transition when guarded audit fails", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const revision = await createRevisionFromDraft(db, staffActor, draft);
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });

    const now = new Date().toISOString();
    const newVersion = 2;
    const postState: ApprovalPostStateGuard = {
      approvalId: approval.id,
      revisionChainId: approval.revisionChainId,
      workflowVersion: newVersion,
      status: "returned",
      currentRevisionId: approval.currentRevisionId,
      currentContentHash: approval.currentContentHash,
      currentHashVersion: approval.currentHashVersion,
    };

    await assert.rejects(() =>
      runMailBatch(db, [
        db
          .update(schema.mailOutboundApprovals)
          .set({
            status: "returned",
            workflowVersion: newVersion,
            resolvedByUserId: reviewerActor.userId,
            resolvedAt: now,
            nextReminderAt: null,
          })
          .where(
            and(
              eq(schema.mailOutboundApprovals.id, approval.id),
              eq(schema.mailOutboundApprovals.workflowVersion, 1),
              eq(schema.mailOutboundApprovals.status, "pending"),
            ),
          ),
        buildApprovalTransitionGuardedEventInsert(db, postState, {
          eventId: crypto.randomUUID(),
          eventType: "returned",
          revisionId: approval.currentRevisionId,
          contentHash: approval.currentContentHash,
          hashVersion: approval.currentHashVersion,
          actorUserId: reviewerActor.userId,
          note: "rollback test",
          now,
        }),
        buildApprovalPostStateGuardedAuditInsert(db, reviewerActor, {
          ...postState,
          workflowVersion: 999,
        }, {
          auditId: crypto.randomUUID(),
          now,
          action: MAIL_AUDIT_ACTIONS.approvalReturned,
          entityId: approval.id,
          metadata: { approvalId: approval.id },
        }),
      ]),
    );

    const loaded = await getApproval(db, reviewerActor, approval.id);
    assert.equal(loaded.status, "pending");
    assert.equal(loaded.workflowVersion, 1);

    const events = await db
      .select()
      .from(schema.mailOutboundApprovalEvents)
      .where(eq(schema.mailOutboundApprovalEvents.approvalId, approval.id));
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "submitted");

    await cleanupFixtures(db);
  });

  it("withdrawn workflow is terminal and cannot resubmit", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const r1 = await createRevisionFromDraft(db, staffActor, draft);
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: r1.id,
    });
    const withdrawn = await withdrawApproval(db, staffActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });
    assert.equal(withdrawn.status, "withdrawn");

    const updatedDraft = await updateDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      bodyText: "After withdraw body",
    });
    const r2 = await createRevisionFromDraft(db, staffActor, updatedDraft);

    await assert.rejects(
      () =>
        resubmitRevisionForApproval(db, staffActor, {
          approvalId: approval.id,
          revisionId: r2.id,
          expectedWorkflowVersion: withdrawn.workflowVersion,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );

    await cleanupFixtures(db);
  });

  it("rejects resubmit when revision belongs to a different chain", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);

    const draftA = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id, {
      subject: "Chain A",
    });
    const r1a = await createRevisionFromDraft(db, staffActor, draftA);
    const approvalA = await submitRevisionForApproval(db, staffActor, {
      revisionId: r1a.id,
    });
    await returnApproval(db, reviewerActor, {
      approvalId: approvalA.id,
      expectedWorkflowVersion: 1,
      note: "Revise chain A",
    });

    const draftB = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id, {
      subject: "Chain B",
    });
    const r1b = await createRevisionFromDraft(db, staffActor, draftB);
    assert.notEqual(r1a.revisionChainId, r1b.revisionChainId);

    await assert.rejects(
      () =>
        resubmitRevisionForApproval(db, staffActor, {
          approvalId: approvalA.id,
          revisionId: r1b.id,
          expectedWorkflowVersion: 2,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );

    await cleanupFixtures(db);
  });

  it("rejects self-approval even when reviewer holds super_admin", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
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

    const draft = await createSendReadyDraft(
      db,
      superAdminActor,
      mailbox.id,
      identity.id,
    );
    const revision = await createRevisionFromDraft(db, superAdminActor, draft);
    const approval = await submitRevisionForApproval(db, superAdminActor, {
      revisionId: revision.id,
    });

    await assert.rejects(
      () =>
        approveRevision(db, superAdminActor, {
          approvalId: approval.id,
          expectedWorkflowVersion: 1,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("permission_mgmt may grant approval_review but cannot review", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const revision = await createRevisionFromDraft(db, staffActor, draft);
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });

    const grant = await grantMailAdminPermission(db, permissionMgmtActor, {
      targetUserId: SEED_IDS.admin,
      permission: "approval_review",
    });
    assert.equal(grant.permission, "approval_review");

    await assert.rejects(
      () =>
        approveRevision(db, permissionMgmtActor, {
          approvalId: approval.id,
          expectedWorkflowVersion: 1,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    const grantedReviewer = actor(SEED_IDS.admin, ["approval_review"]);
    await approveRevision(db, grantedReviewer, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });

    await revokeMailAdminGrant(db, permissionMgmtActor, { grantId: grant.id });
    await cleanupFixtures(db);
  });

  it("account_mgmt alone cannot access reviewer approval queue", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const revision = await createRevisionFromDraft(db, staffActor, draft);
    await submitRevisionForApproval(db, staffActor, { revisionId: revision.id });

    const accountMgmtReviewer = actor(SEED_IDS.admin, ["account_mgmt"]);
    await assert.rejects(
      () => listApprovalsForReviewer(db, accountMgmtReviewer),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("lists author and reviewer queues", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const revision = await createRevisionFromDraft(db, staffActor, draft);
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
      priority: "urgent",
    });

    const authorItems = await listApprovalsForAuthor(db, staffActor, {
      status: "pending",
    });
    assert.ok(authorItems.some((item) => item.id === approval.id));

    const reviewerItems = await listApprovalsForReviewer(db, reviewerActor);
    assert.ok(reviewerItems.some((item) => item.id === approval.id));
    assert.equal(reviewerItems[0]?.priority, "urgent");

    await cleanupFixtures(db);
  });
});
