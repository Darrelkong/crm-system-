import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, asc, eq, inArray, like } from "drizzle-orm";
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
import {
  createAdminDirectRevisionFromDraft,
  createOutboundRevisionFromDraft,
} from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess, revokeSenderIdentityGrant } from "@/lib/mail/sender-identity-grant-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import { createSignatureVersion } from "@/lib/mail/signature-service";
import {
  dispatchSendOperation,
  initiateAdminDirectSend,
  initiateStaffApprovedSend,
  retrySendOperation,
} from "@/lib/mail/send-operation-service";
import {
  attemptInvalidMaterializationBatch,
  materializeAcceptedOutboundSend,
  sentMessageMaterializationTestHooks,
} from "@/lib/mail/sent-message-materialization-service";
import { FakeMailTransportAdapter } from "@/lib/mail/transport/fake-mail-transport-adapter";

const FIXTURE = "mail-phase2c8";

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
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c8-test" },
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

async function deleteMessageGraph(db: TestDb, messageIds: string[]) {
  if (!messageIds.length) return;

  await db
    .delete(schema.mailOutboundMessageMaterializations)
    .where(inArray(schema.mailOutboundMessageMaterializations.mailMessageId, messageIds));
  await db
    .delete(schema.mailMessageAttachments)
    .where(inArray(schema.mailMessageAttachments.messageId, messageIds));
  await db
    .delete(schema.mailMessageRecipients)
    .where(inArray(schema.mailMessageRecipients.messageId, messageIds));
  await db
    .delete(schema.mailMessageBodies)
    .where(inArray(schema.mailMessageBodies.messageId, messageIds));
  const threads = await db
    .select({ threadId: schema.mailMessages.threadId })
    .from(schema.mailMessages)
    .where(inArray(schema.mailMessages.id, messageIds));
  const threadIds = [...new Set(threads.map((row) => row.threadId))];
  await db
    .delete(schema.mailMessages)
    .where(inArray(schema.mailMessages.id, messageIds));
  if (threadIds.length) {
    await db
      .delete(schema.mailThreads)
      .where(inArray(schema.mailThreads.id, threadIds));
  }
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

  if (mailboxIds.length) {
    const orphanMessages = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(inArray(schema.mailMessages.mailboxId, mailboxIds));
    const orphanMessageIds = orphanMessages.map((row) => row.id);

    if (orphanMessageIds.length) {
      await deleteMessageGraph(db, orphanMessageIds);
    }
  }

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
  const revisionIds = revisions.map((row) => row.id);
  const chainIds = [...new Set(revisions.map((row) => row.chainId))];

  const sendOps = revisionIds.length
    ? await db
        .select({ id: schema.mailSendOperations.id })
        .from(schema.mailSendOperations)
        .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds))
    : [];
  const sendIds = sendOps.map((row) => row.id);

  const materializations = sendIds.length
    ? await db
        .select({ mailMessageId: schema.mailOutboundMessageMaterializations.mailMessageId })
        .from(schema.mailOutboundMessageMaterializations)
        .where(inArray(schema.mailOutboundMessageMaterializations.sendOperationId, sendIds))
    : [];
  const messageIds = materializations.map((row) => row.mailMessageId);

  if (sendIds.length) {
    await db
      .delete(schema.mailOutboundMessageMaterializations)
      .where(inArray(schema.mailOutboundMessageMaterializations.sendOperationId, sendIds));
  }

  if (messageIds.length) {
    await deleteMessageGraph(db, messageIds);
  }

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
    const identityMessages = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(inArray(schema.mailMessages.senderIdentityId, identityIds));
    await deleteMessageGraph(
      db,
      identityMessages.map((row) => row.id),
    );

    const signatureVersions = await db
      .select({ id: schema.mailSignatureVersions.id })
      .from(schema.mailSignatureVersions)
      .where(inArray(schema.mailSignatureVersions.senderIdentityId, identityIds));
    const signatureVersionIds = signatureVersions.map((row) => row.id);
    if (signatureVersionIds.length) {
      await db
        .delete(schema.mailSignatureVersionAssets)
        .where(
          inArray(
            schema.mailSignatureVersionAssets.signatureVersionId,
            signatureVersionIds,
          ),
        );
      await db
        .delete(schema.mailSignatureVersions)
        .where(inArray(schema.mailSignatureVersions.id, signatureVersionIds));
    }

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
    .delete(schema.mailStoredFiles)
    .where(like(schema.mailStoredFiles.id, `${FIXTURE}%`));
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

async function setupSentFolderFixture(db: TestDb) {
  const composeAddress = fixtureAddress("compose-mailbox");
  const sentAddress = fixtureAddress("sent-mailbox");
  const composeMailbox = await createMailbox(db, setupAdminActor, {
    address: composeAddress,
    mailboxType: "personal",
  });
  const sentMailbox = await createMailbox(db, setupAdminActor, {
    address: sentAddress,
    mailboxType: "personal",
  });
  const identityAddress = fixtureAddress("dual-mailbox");
  const identity = await createSenderIdentity(db, setupAdminActor, {
    address: identityAddress,
    defaultMailboxId: composeMailbox.id,
    sentFolderMailboxId: sentMailbox.id,
  });
  await grantSenderIdentityAccess(db, setupAdminActor, {
    senderIdentityId: identity.id,
    targetUserId: SEED_IDS.admin,
    canSend: true,
  });
  const now = new Date().toISOString();
  for (const [suffix, mailboxId] of [
    ["compose", composeMailbox.id],
    ["sent", sentMailbox.id],
  ] as const) {
    await db.insert(schema.mailMailboxMembers).values({
      id: `${FIXTURE}-dual-${suffix}`,
      mailboxId,
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
  }
  return { composeMailbox, sentMailbox, identity };
}

async function createSendReadyDraft(
  db: TestDb,
  actorCtx: MailActorContext,
  mailboxId: string,
  identityId: string,
  subject = "Send subject",
): Promise<DraftDetailView> {
  const created = await createDraft(db, actorCtx, {
    senderIdentityId: identityId,
    mailboxId,
    subject,
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

async function createProductionAdminDirectRevision(db: TestDb) {
  const { mailbox, identity } = await setupAdminComposeFixture(db);
  const draft = await createSendReadyDraft(db, adminActor, mailbox.id, identity.id);
  const revision = await createAdminDirectRevisionFromDraft(db, adminActor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
  });
  return { mailbox, identity, draft, revision };
}

async function acceptAdminDirectSend(db: TestDb, revisionId: string) {
  const initiated = await initiateAdminDirectSend(db, adminActor, {
    revisionId,
    idempotencyKey: `${FIXTURE}-accept-${revisionId}`,
  });
  const adapter = new FakeMailTransportAdapter().setBehavior({
    outcome: "accepted",
    providerRequestId: "req",
    providerMessageId: "msg",
  });
  const dispatched = await dispatchSendOperation(db, adminActor, {
    sendOperationId: initiated.id,
    expectedOrchestrationVersion: initiated.orchestrationVersion,
    adapter,
  });
  assert.equal(dispatched.status, "accepted");
  return { initiated, dispatched };
}

async function assertNoDeliveryEvents(db: TestDb, sendOperationId: string) {
  const events = await db
    .select()
    .from(schema.mailDeliveryEvents)
    .where(eq(schema.mailDeliveryEvents.sendOperationId, sendOperationId));
  assert.equal(events.length, 0);
}

describe("sent message materialization integration", () => {
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
    assert.ok(sentMessageMaterializationTestHooks);
  });

  after(async () => {
    try {
      await cleanupFixtures(db);
    } finally {
      dispose?.();
    }
  });

  it("admin_direct accepted send materializes canonical outbound message", async () => {
    await cleanupFixtures(db);
    const { revision } = await createProductionAdminDirectRevision(db);
    const { initiated, dispatched } = await acceptAdminDirectSend(db, revision.id);

    const result = await materializeAcceptedOutboundSend(db, initiated.id);
    assert.equal(result.message.direction, "outbound");
    assert.equal(result.message.internetMessageId, dispatched.rfcIdentity?.rfcMessageId);
    assert.equal(
      result.materialization.wireInternetMessageId,
      dispatched.rfcIdentity?.rfcMessageId,
    );
    assert.equal(
      result.materialization.rfcMessageId,
      dispatched.rfcIdentity?.rfcMessageId,
    );
    assert.ok(result.materialization.rfcMessageId);
    assert.equal(result.materialization.sendOperationId, initiated.id);
    assert.equal(result.materialization.outboundRevisionId, revision.id);
    assert.equal(result.view.recipientCount, 1);

    const [body] = await db
      .select()
      .from(schema.mailMessageBodies)
      .where(eq(schema.mailMessageBodies.messageId, result.message.id))
      .limit(1);
    assert.ok(body);
    assert.equal(body.bodyText, "Send body");

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, initiated.id),
          eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.sentMaterialized),
        ),
      );
    assert.equal(audits.length, 1);

    await assertNoDeliveryEvents(db, initiated.id);
  });

  it("staff approved accepted send materializes with full recipient set including Bcc", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupStaffComposeFixture(db);
    let draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    draft = await addDraftRecipient(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      recipientType: "cc",
      address: "cc@example.com",
    });
    draft = await addDraftRecipient(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      recipientType: "bcc",
      address: "bcc@example.com",
    });
    const revision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });
    await approveRevision(db, approvalReviewActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });

    const initiated = await initiateStaffApprovedSend(db, approvalReviewActor, {
      revisionId: revision.id,
      idempotencyKey: `${FIXTURE}-staff-bcc`,
    });
    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "accepted",
      providerRequestId: "staff-req",
      providerMessageId: "staff-msg",
    });
    await dispatchSendOperation(db, approvalReviewActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });

    const result = await materializeAcceptedOutboundSend(db, initiated.id);
    const recipients = await db
      .select()
      .from(schema.mailMessageRecipients)
      .where(eq(schema.mailMessageRecipients.messageId, result.message.id));
    assert.equal(recipients.length, 3);
    const types = recipients.map((row) => row.recipientType).sort();
    assert.deepEqual(types, ["bcc", "cc", "to"]);
  });

  it("temp failure retry then accepted materializes once with stable RFC", async () => {
    await cleanupFixtures(db);
    const { revision } = await createProductionAdminDirectRevision(db);
    const initiated = await initiateAdminDirectSend(db, adminActor, {
      revisionId: revision.id,
      idempotencyKey: `${FIXTURE}-temp-retry-mat`,
    });
    const adapter = new FakeMailTransportAdapter()
      .queueBehavior({ outcome: "temporary_failure", errorCode: "TEMP" })
      .queueBehavior({
        outcome: "accepted",
        providerRequestId: "retry-req",
        providerMessageId: "retry-msg",
      });
    const afterTemp = await dispatchSendOperation(db, adminActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    assert.equal(afterTemp.status, "pending");
    const afterRetry = await retrySendOperation(db, adminActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: afterTemp.orchestrationVersion,
      adapter,
    });
    assert.equal(afterRetry.status, "accepted");
    assert.equal(afterRetry.transportAttempts?.length, 2);
    assert.equal(afterRetry.transportAttempts?.[0]?.state, "temporary_failure");
    assert.equal(afterRetry.transportAttempts?.[1]?.state, "accepted");

    const result = await materializeAcceptedOutboundSend(db, initiated.id);
    assert.equal(
      result.materialization.acceptedTransportAttemptId,
      afterRetry.transportAttempts?.[1]?.id,
    );
    assert.equal(result.message.internetMessageId, afterRetry.rfcIdentity?.rfcMessageId);
    assert.equal(
      result.materialization.wireInternetMessageId,
      afterRetry.rfcIdentity?.rfcMessageId,
    );
    assert.equal(
      result.materialization.rfcMessageId,
      afterRetry.rfcIdentity?.rfcMessageId,
    );
  });

  it("rejects materialization for processing send with started attempt", async () => {
    await cleanupFixtures(db);
    const { revision } = await createProductionAdminDirectRevision(db);
    const initiated = await initiateAdminDirectSend(db, adminActor, {
      revisionId: revision.id,
      idempotencyKey: `${FIXTURE}-started`,
    });
    const adapter = new FakeMailTransportAdapter().setBehavior("throw");
    const dispatched = await dispatchSendOperation(db, adminActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    assert.equal(dispatched.status, "processing");
    assert.equal(dispatched.transportAttempts?.[0]?.state, "started");

    await assert.rejects(
      () => materializeAcceptedOutboundSend(db, initiated.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 400,
    );
  });

  it("rejects materialization for permanent failure send", async () => {
    await cleanupFixtures(db);
    const { revision } = await createProductionAdminDirectRevision(db);
    const initiated = await initiateAdminDirectSend(db, adminActor, {
      revisionId: revision.id,
      idempotencyKey: `${FIXTURE}-perm-fail`,
    });
    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "permanent_failure",
      errorCode: "PERM",
      errorMessage: "blocked",
    });
    const dispatched = await dispatchSendOperation(db, adminActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    assert.equal(dispatched.status, "failed");

    await assert.rejects(
      () => materializeAcceptedOutboundSend(db, initiated.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 400,
    );
  });

  it("rejects materialization when revision hash is tampered", async () => {
    await cleanupFixtures(db);
    const { revision } = await createProductionAdminDirectRevision(db);
    const { initiated } = await acceptAdminDirectSend(db, revision.id);
    await db
      .update(schema.mailOutboundRevisions)
      .set({ subject: "Tampered subject" })
      .where(eq(schema.mailOutboundRevisions.id, revision.id));

    await assert.rejects(
      () => materializeAcceptedOutboundSend(db, initiated.id),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "INTEGRITY_CONFLICT",
    );
  });

  it("idempotent materialization returns same canonical message", async () => {
    await cleanupFixtures(db);
    const { revision } = await createProductionAdminDirectRevision(db);
    const { initiated, dispatched } = await acceptAdminDirectSend(db, revision.id);

    const first = await materializeAcceptedOutboundSend(db, initiated.id);
    const second = await materializeAcceptedOutboundSend(db, initiated.id);
    assert.equal(first.message.id, second.message.id);
    assert.equal(first.materialization.id, second.materialization.id);

    const allMessages = await db.select().from(schema.mailMessages);
    const fixtureMessages = allMessages.filter((row) =>
      row.subject.includes("Send subject"),
    );
    assert.equal(fixtureMessages.length, 1);
    assert.equal(first.message.internetMessageId, dispatched.rfcIdentity?.rfcMessageId);
    assert.equal(
      first.materialization.wireInternetMessageId,
      dispatched.rfcIdentity?.rfcMessageId,
    );
  });

  it("verification rejects wire identity mismatch with canonical message", async () => {
    await cleanupFixtures(db);
    const { revision } = await createProductionAdminDirectRevision(db);
    const { initiated } = await acceptAdminDirectSend(db, revision.id);
    const materialized = await materializeAcceptedOutboundSend(db, initiated.id);
    const wireId = "<wire-known@echfronthk.com>";

    assert.throws(
      () =>
        sentMessageMaterializationTestHooks!.assertWireIdentityConsistency(
          {
            ...materialized.materialization,
            wireInternetMessageId: wireId,
          },
          {
            ...materialized.message,
            internetMessageId: "<different-wire@echfronthk.com>",
          },
        ),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "INTEGRITY_CONFLICT",
    );
  });

  it("post-acceptance sender grant revocation still materializes", async () => {
    await cleanupFixtures(db);
    const { identity, revision } = await createProductionAdminDirectRevision(db);
    const { initiated } = await acceptAdminDirectSend(db, revision.id);

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

    const result = await materializeAcceptedOutboundSend(db, initiated.id);
    assert.equal(result.message.direction, "outbound");
  });

  it("uses sent_folder_mailbox_id when distinct from default compose mailbox", async () => {
    await cleanupFixtures(db);
    const { composeMailbox, sentMailbox, identity } =
      await setupSentFolderFixture(db);
    const draft = await createSendReadyDraft(
      db,
      adminActor,
      composeMailbox.id,
      identity.id,
      "Sent folder placement",
    );
    const revision = await createAdminDirectRevisionFromDraft(db, adminActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });
    const { initiated } = await acceptAdminDirectSend(db, revision.id);
    const result = await materializeAcceptedOutboundSend(db, initiated.id);
    assert.equal(result.mailboxId, sentMailbox.id);
    assert.notEqual(result.mailboxId, composeMailbox.id);
    assert.equal(revision.mailboxId, composeMailbox.id);
  });

  it("preserves attachment order and source revision provenance", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupAdminComposeFixture(db);
    const draft = await createSendReadyDraft(db, adminActor, mailbox.id, identity.id);

    const now = new Date().toISOString();
    const fileA = `${FIXTURE}-file-a`;
    const fileB = `${FIXTURE}-file-b`;
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    await db.insert(schema.mailStoredFiles).values([
      {
        id: fileA,
        contentHash: hashA,
        originalFilename: "first.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        storageProvider: "r2",
        storageBucket: "mail-test",
        storageKey: `${FIXTURE}/first.pdf`,
        securityScanStatus: "clean",
        securityScannedAt: now,
        createdAt: now,
      },
      {
        id: fileB,
        contentHash: hashB,
        originalFilename: "second.pdf",
        mimeType: "application/pdf",
        sizeBytes: 200,
        storageProvider: "r2",
        storageBucket: "mail-test",
        storageKey: `${FIXTURE}/second.pdf`,
        securityScanStatus: "clean",
        securityScannedAt: now,
        createdAt: now,
      },
    ]);

    const draftAttachmentA = `${FIXTURE}-draft-att-a`;
    const draftAttachmentB = `${FIXTURE}-draft-att-b`;
    await db.insert(schema.mailDraftAttachments).values([
      {
        id: draftAttachmentA,
        draftId: draft.id,
        storedFileId: fileA,
        displayFilename: "First.pdf",
        sortOrder: 0,
        deliveryMode: "direct_attachment",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: draftAttachmentB,
        draftId: draft.id,
        storedFileId: fileB,
        displayFilename: "Second.pdf",
        sortOrder: 1,
        deliveryMode: "secure_file",
        secureExpiryDays: 7,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const revision = await createAdminDirectRevisionFromDraft(db, adminActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });
    const revisionAttachments = await db
      .select()
      .from(schema.mailOutboundRevisionAttachments)
      .where(eq(schema.mailOutboundRevisionAttachments.revisionId, revision.id))
      .orderBy(asc(schema.mailOutboundRevisionAttachments.sortOrder));
    assert.equal(revisionAttachments.length, 2);

    const { initiated } = await acceptAdminDirectSend(db, revision.id);
    const result = await materializeAcceptedOutboundSend(db, initiated.id);
    const attachments = await db
      .select()
      .from(schema.mailMessageAttachments)
      .where(eq(schema.mailMessageAttachments.messageId, result.message.id))
      .orderBy(asc(schema.mailMessageAttachments.sortOrder));
    assert.equal(attachments.length, 2);
    assert.equal(
      attachments[0]?.sourceRevisionAttachmentId,
      revisionAttachments[0]?.id,
    );
    assert.equal(
      attachments[1]?.sourceRevisionAttachmentId,
      revisionAttachments[1]?.id,
    );
    assert.equal(attachments[0]?.displayFilename, "First.pdf");
    assert.equal(attachments[1]?.deliveryMode, "secure_file");
    assert.equal(attachments[1]?.secureExpiryDays, 7);
  });

  it("uses frozen revision signature snapshot not live signature version", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupAdminComposeFixture(db);
    const draft = await createSendReadyDraft(
      db,
      adminActor,
      mailbox.id,
      identity.id,
      "Signature snapshot test",
    );
    const revision = await createAdminDirectRevisionFromDraft(db, adminActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });

    const [snapshot] = await db
      .select()
      .from(schema.mailSignatureSnapshots)
      .where(eq(schema.mailSignatureSnapshots.id, revision.signatureSnapshotId))
      .limit(1);
    assert.ok(snapshot);

    await createSignatureVersion(db, setupAdminActor, {
      senderIdentityId: identity.id,
      bodyText: "Live signature V2 — must not appear",
      bodyHtml: "<p>Live signature V2</p>",
    });

    const { initiated } = await acceptAdminDirectSend(db, revision.id);
    const result = await materializeAcceptedOutboundSend(db, initiated.id);
    const [body] = await db
      .select()
      .from(schema.mailMessageBodies)
      .where(eq(schema.mailMessageBodies.messageId, result.message.id))
      .limit(1);
    assert.ok(body);
    assert.equal(body.bodyText, "Send body");
    assert.notEqual(body.bodyText, "Live signature V2 — must not appear");
  });

  it("late failure rolls back partial materialization graph", async () => {
    await cleanupFixtures(db);
    const { revision } = await createProductionAdminDirectRevision(db);
    const { initiated } = await acceptAdminDirectSend(db, revision.id);

    await assert.rejects(() => attemptInvalidMaterializationBatch(db, initiated.id));

    const materializations = await db
      .select()
      .from(schema.mailOutboundMessageMaterializations)
      .where(eq(schema.mailOutboundMessageMaterializations.sendOperationId, initiated.id));
    assert.equal(materializations.length, 0);

    const messages = await db.select().from(schema.mailMessages);
    const fixtureMessages = messages.filter((row) => row.subject === "Send subject");
    assert.equal(fixtureMessages.length, 0);
  });
});
