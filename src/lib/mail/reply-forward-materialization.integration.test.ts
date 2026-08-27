import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import { bindTestDatabase, schema } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { createSeededComposeDraft } from "@/lib/mail/compose-draft-seed-service";
import { addDraftRecipient, updateDraft } from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import {
  approveRevision,
  submitRevisionForApproval,
} from "@/lib/mail/outbound-approval-service";
import { createOutboundRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  dispatchSendOperation,
  initiateStaffApprovedSend,
} from "@/lib/mail/send-operation-service";
import { materializeAcceptedOutboundSend } from "@/lib/mail/sent-message-materialization-service";
import { resolveInboundThread } from "@/lib/mail/inbound-thread-resolution";
import { FakeMailTransportAdapter } from "@/lib/mail/transport/fake-mail-transport-adapter";
import { buildCloudflareEmailOutboundSendRequestForTest } from "@/lib/mail/cloudflare-email-outbound-transport-adapter";

const FIXTURE = "mail-phase2h6c";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(userId: string, grants: MailActorContext["adminGrants"] = []) {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2h6c-test" },
  } as MailActorContext;
}

const adminActor = actor(SEED_IDS.admin, [
  "account_mgmt",
  "address_assignment",
  "signature_template",
  "approval_review",
]);
const staffActor = actor(SEED_IDS.staffA);
const approvalActor = actor(SEED_IDS.staffB, ["approval_review"]);

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

async function deleteFixtureMessagesByIds(db: TestDb, messageIds: string[]) {
  if (!messageIds.length) return;

  await db
    .delete(schema.mailOutboundMessageMaterializations)
    .where(inArray(schema.mailOutboundMessageMaterializations.mailMessageId, messageIds));

  const messages = await db
    .select({
      id: schema.mailMessages.id,
      replyToMessageId: schema.mailMessages.replyToMessageId,
    })
    .from(schema.mailMessages)
    .where(inArray(schema.mailMessages.id, messageIds));

  const childMessageIds = messages
    .filter(
      (row) => row.replyToMessageId && messageIds.includes(row.replyToMessageId),
    )
    .map((row) => row.id);
  const parentMessageIds = messageIds.filter((id) => !childMessageIds.includes(id));

  for (const ids of [childMessageIds, parentMessageIds]) {
    if (!ids.length) continue;
    await db
      .delete(schema.mailMessageRecipients)
      .where(inArray(schema.mailMessageRecipients.messageId, ids));
    await db
      .delete(schema.mailMessageBodies)
      .where(inArray(schema.mailMessageBodies.messageId, ids));
    await db.delete(schema.mailMessages).where(inArray(schema.mailMessages.id, ids));
  }
}

async function deleteFixtureMessagesForMailboxes(db: TestDb, mailboxIds: string[]) {
  if (!mailboxIds.length) return;

  const messages = await db
    .select({ id: schema.mailMessages.id })
    .from(schema.mailMessages)
    .where(inArray(schema.mailMessages.mailboxId, mailboxIds));
  const messageIds = messages.map((row) => row.id);
  if (!messageIds.length) return;

  const referencingRevisions = await db
    .select({ id: schema.mailOutboundRevisions.id, chainId: schema.mailOutboundRevisions.revisionChainId })
    .from(schema.mailOutboundRevisions)
    .where(inArray(schema.mailOutboundRevisions.replyToMessageId, messageIds));
  const revisionIds = referencingRevisions.map((row) => row.id);
  const chainIds = [...new Set(referencingRevisions.map((row) => row.chainId))];
  if (revisionIds.length) {
    const sends = await db
      .select({ id: schema.mailSendOperations.id })
      .from(schema.mailSendOperations)
      .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds));
    await deleteSendOperationsGraph(
      db,
      sends.map((row) => row.id),
    );
    if (chainIds.length) {
      await db
        .delete(schema.mailOutboundApprovalEvents)
        .where(inArray(schema.mailOutboundApprovalEvents.revisionChainId, chainIds));
      await db
        .delete(schema.mailOutboundApprovals)
        .where(inArray(schema.mailOutboundApprovals.revisionChainId, chainIds));
    }
    await db
      .delete(schema.mailOutboundRevisionRecipients)
      .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds));
    await db
      .delete(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.id, revisionIds));
  }

  const referencingDrafts = await db
    .select({ id: schema.mailDrafts.id })
    .from(schema.mailDrafts)
    .where(inArray(schema.mailDrafts.replyToMessageId, messageIds));
  const referencingDraftIds = referencingDrafts.map((row) => row.id);
  if (referencingDraftIds.length) {
    await db
      .delete(schema.mailDraftRecipients)
      .where(inArray(schema.mailDraftRecipients.draftId, referencingDraftIds));
    await db
      .delete(schema.mailDrafts)
      .where(inArray(schema.mailDrafts.id, referencingDraftIds));
  }

  await deleteFixtureMessagesByIds(db, messageIds);
}

async function deleteSendOperationsGraph(db: TestDb, sendIds: string[]) {
  if (!sendIds.length) return;

  const materializations = await db
    .select({
      mailMessageId: schema.mailOutboundMessageMaterializations.mailMessageId,
    })
    .from(schema.mailOutboundMessageMaterializations)
    .where(inArray(schema.mailOutboundMessageMaterializations.sendOperationId, sendIds));
  const materializedMessageIds = materializations
    .map((row) => row.mailMessageId)
    .filter((id): id is string => Boolean(id));

  await db
    .delete(schema.mailOutboundMessageMaterializations)
    .where(inArray(schema.mailOutboundMessageMaterializations.sendOperationId, sendIds));
  await deleteFixtureMessagesByIds(db, materializedMessageIds);
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

async function cleanupFixtures(db: TestDb) {
  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);
  if (!mailboxIds.length) return;

  const identities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));
  const identityIds = identities.map((row) => row.id);
  if (identityIds.length) {
    const drafts = await db
      .select({ id: schema.mailDrafts.id })
      .from(schema.mailDrafts)
      .where(inArray(schema.mailDrafts.senderIdentityId, identityIds));
    const draftIds = drafts.map((d) => d.id);
    if (draftIds.length) {
      const revisions = await db
        .select({ id: schema.mailOutboundRevisions.id, chainId: schema.mailOutboundRevisions.revisionChainId })
        .from(schema.mailOutboundRevisions)
        .where(inArray(schema.mailOutboundRevisions.sourceDraftId, draftIds));
      const revisionIds = revisions.map((r) => r.id);
      const chainIds = [...new Set(revisions.map((r) => r.chainId))];
      if (revisionIds.length) {
        const sends = await db
          .select({ id: schema.mailSendOperations.id })
          .from(schema.mailSendOperations)
          .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds));
        const sendIds = sends.map((s) => s.id);
        if (sendIds.length) {
          await deleteSendOperationsGraph(db, sendIds);
        }
        if (chainIds.length) {
          await db.delete(schema.mailOutboundApprovalEvents).where(inArray(schema.mailOutboundApprovalEvents.revisionChainId, chainIds));
          await db.delete(schema.mailOutboundApprovals).where(inArray(schema.mailOutboundApprovals.revisionChainId, chainIds));
        }
        await db.delete(schema.mailOutboundRevisionRecipients).where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds));
        await db.delete(schema.mailOutboundRevisions).where(inArray(schema.mailOutboundRevisions.id, revisionIds));
      }
      await db.delete(schema.mailDraftRecipients).where(inArray(schema.mailDraftRecipients.draftId, draftIds));
      await db.delete(schema.mailDrafts).where(inArray(schema.mailDrafts.id, draftIds));
    }

    const identityMessages = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(inArray(schema.mailMessages.senderIdentityId, identityIds));
    await deleteFixtureMessagesByIds(
      db,
      identityMessages.map((row) => row.id),
    );

    const orphanRevisions = await db
      .select({ id: schema.mailOutboundRevisions.id, chainId: schema.mailOutboundRevisions.revisionChainId })
      .from(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.senderIdentityId, identityIds));
    const orphanRevisionIds = orphanRevisions.map((row) => row.id);
    const orphanChainIds = [...new Set(orphanRevisions.map((row) => row.chainId))];
    if (orphanRevisionIds.length) {
      const sends = await db
        .select({ id: schema.mailSendOperations.id })
        .from(schema.mailSendOperations)
        .where(inArray(schema.mailSendOperations.outboundRevisionId, orphanRevisionIds));
      const sendIds = sends.map((row) => row.id);
      if (sendIds.length) {
        await deleteSendOperationsGraph(db, sendIds);
      }
      if (orphanChainIds.length) {
        await db
          .delete(schema.mailOutboundApprovalEvents)
          .where(inArray(schema.mailOutboundApprovalEvents.revisionChainId, orphanChainIds));
        await db
          .delete(schema.mailOutboundApprovals)
          .where(inArray(schema.mailOutboundApprovals.revisionChainId, orphanChainIds));
      }
      await db
        .delete(schema.mailOutboundRevisionRecipients)
        .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, orphanRevisionIds));
      await db
        .delete(schema.mailOutboundRevisions)
        .where(inArray(schema.mailOutboundRevisions.id, orphanRevisionIds));
    }

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
      .delete(schema.mailSignatureSnapshots)
      .where(inArray(schema.mailSignatureSnapshots.senderIdentityId, identityIds));

    await db.delete(schema.mailSenderIdentityGrants).where(inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds));
    await db.delete(schema.mailSenderIdentities).where(inArray(schema.mailSenderIdentities.id, identityIds));
  }

  await deleteFixtureMessagesForMailboxes(db, mailboxIds);

  const threads = await db
    .select({ id: schema.mailThreads.id })
    .from(schema.mailThreads)
    .where(inArray(schema.mailThreads.mailboxId, mailboxIds));
  if (threads.length) {
    await db
      .delete(schema.mailThreads)
      .where(inArray(schema.mailThreads.id, threads.map((t) => t.id)));
  }

  await db
    .delete(schema.mailReceivingAddresses)
    .where(inArray(schema.mailReceivingAddresses.mailboxId, mailboxIds));
  await db.delete(schema.mailMailboxMembers).where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));
  await db.delete(schema.mailMailboxes).where(inArray(schema.mailMailboxes.id, mailboxIds));
}

/** Clears messages/threads/sends between tests while keeping mailbox + identity setup. */
async function cleanupFixtureRuntimeState(db: TestDb) {
  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);
  if (!mailboxIds.length) return;

  const identities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));
  const identityIds = identities.map((row) => row.id);

  if (identityIds.length) {
    const drafts = await db
      .select({ id: schema.mailDrafts.id })
      .from(schema.mailDrafts)
      .where(inArray(schema.mailDrafts.senderIdentityId, identityIds));
    const draftIds = drafts.map((d) => d.id);
    if (draftIds.length) {
      const revisions = await db
        .select({
          id: schema.mailOutboundRevisions.id,
          chainId: schema.mailOutboundRevisions.revisionChainId,
        })
        .from(schema.mailOutboundRevisions)
        .where(inArray(schema.mailOutboundRevisions.sourceDraftId, draftIds));
      const revisionIds = revisions.map((r) => r.id);
      const chainIds = [...new Set(revisions.map((r) => r.chainId))];
      if (revisionIds.length) {
        const sends = await db
          .select({ id: schema.mailSendOperations.id })
          .from(schema.mailSendOperations)
          .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds));
        const sendIds = sends.map((s) => s.id);
        if (sendIds.length) {
          await deleteSendOperationsGraph(db, sendIds);
        }
        if (chainIds.length) {
          await db
            .delete(schema.mailOutboundApprovalEvents)
            .where(inArray(schema.mailOutboundApprovalEvents.revisionChainId, chainIds));
          await db
            .delete(schema.mailOutboundApprovals)
            .where(inArray(schema.mailOutboundApprovals.revisionChainId, chainIds));
        }
        await db
          .delete(schema.mailOutboundRevisionRecipients)
          .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds));
        await db
          .delete(schema.mailOutboundRevisions)
          .where(inArray(schema.mailOutboundRevisions.id, revisionIds));
      }
      await db
        .delete(schema.mailDraftRecipients)
        .where(inArray(schema.mailDraftRecipients.draftId, draftIds));
      await db.delete(schema.mailDrafts).where(inArray(schema.mailDrafts.id, draftIds));
    }
  }

  await deleteFixtureMessagesForMailboxes(db, mailboxIds);

  await db
    .delete(schema.mailThreads)
    .where(inArray(schema.mailThreads.mailboxId, mailboxIds));
}

async function insertInboundSource(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    threadId: string;
    internetMessageId?: string;
    referencesHeader?: string | null;
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailThreads).values({
    id: input.threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: "hello",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId: input.threadId,
    mailboxId: input.mailboxId,
    direction: "inbound",
    fromAddress: "client@example.com",
    fromDisplayName: "Client",
    subject: "Hello",
    subjectNormalized: "hello",
    previewText: "Hello",
    internetMessageId: input.internetMessageId ?? "<source-msg@example.com>",
    inReplyTo: null,
    referencesHeader: input.referencesHeader ?? null,
    replyToMessageId: null,
    composeMode: null,
    receivedAt: now,
    sentAt: null,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: "Source body",
    bodyHtmlSanitized: "<p>Source body</p>",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageRecipients).values({
    id: `${input.id}-to`,
    messageId: input.id,
    recipientType: "to",
    address: fixtureAddress("staff"),
    displayName: null,
    sortOrder: 0,
    createdAt: now,
  });
}

async function setupMailboxWithIdentity(db: TestDb, suffix: string) {
  const address = fixtureAddress(suffix);
  const mailbox = await createMailbox(db, adminActor, {
    address,
    mailboxType: "personal",
    ownerUserId: SEED_IDS.staffA,
  });
  const identity = await createSenderIdentity(db, adminActor, {
    address,
    defaultMailboxId: mailbox.id,
  });
  await grantSenderIdentityAccess(db, adminActor, {
    senderIdentityId: identity.id,
    targetUserId: SEED_IDS.staffA,
    canSend: true,
  });
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: `${FIXTURE}-member-${suffix}`,
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

async function addForwardRecipient(
  db: TestDb,
  draft: { id: string; autosaveVersion: number },
) {
  return addDraftRecipient(db, staffActor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
    recipientType: "to",
    address: "forward-recipient@example.com",
    displayName: null,
  });
}

function fixtureProviderMessageId(revisionId: string): string {
  return `<provider-${revisionId}@test.echfronthk.com>`;
}

async function materializeSeededDraft(
  db: TestDb,
  draftId: string,
  autosaveVersion: number,
) {
  const revision = await createOutboundRevisionFromDraft(db, staffActor, {
    draftId,
    expectedAutosaveVersion: autosaveVersion,
  });
  const approval = await submitRevisionForApproval(db, staffActor, {
    revisionId: revision.id,
  });
  await approveRevision(db, approvalActor, {
    approvalId: approval.id,
    expectedWorkflowVersion: 1,
  });
  const initiated = await initiateStaffApprovedSend(db, approvalActor, {
    revisionId: revision.id,
    idempotencyKey: `${FIXTURE}-send-${revision.id}`,
  });
  const providerMessageId = fixtureProviderMessageId(revision.id);
  const adapter = new FakeMailTransportAdapter().setBehavior({
    outcome: "accepted",
    providerRequestId: "req",
    providerMessageId,
  });
  await dispatchSendOperation(db, approvalActor, {
    sendOperationId: initiated.id,
    expectedOrchestrationVersion: initiated.orchestrationVersion,
    adapter,
  });
  return materializeAcceptedOutboundSend(db, initiated.id);
}

describe("reply forward materialization integration", () => {
  let db: TestDb;
  let dispose: () => Promise<void>;
  let mailboxId: string;
  let identityId: string;

  before(async () => {
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    await cleanupFixtures(db);
    await enableMailAccess(db, SEED_IDS.staffA);
    await enableMailAccess(db, SEED_IDS.staffB);
    const setup = await setupMailboxWithIdentity(db, "staff");
    mailboxId = setup.mailbox.id;
    identityId = setup.identity.id;
  });

  after(async () => {
    bindTestDatabase(null);
    await dispose();
  });

  it("same-mailbox reply reuses source thread and sets RFC threading", async () => {
    const sourceId = `${FIXTURE}-source-reply`;
    const threadId = `${FIXTURE}-thread-reply`;
    await insertInboundSource(db, {
      id: sourceId,
      mailboxId,
      threadId,
      internetMessageId: "<inbound-source@example.com>",
    });

    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: sourceId,
      mode: "reply",
      folder: "inbox",
    });
    const result = await materializeSeededDraft(db, draft.id, draft.autosaveVersion);

    assert.equal(result.threadId, threadId);
    assert.equal(result.message.composeMode, "reply");
    assert.equal(result.message.replyToMessageId, sourceId);
    assert.equal(result.message.inReplyTo, "<inbound-source@example.com>");
    assert.ok(result.message.internetMessageId);
    assert.equal(
      result.message.internetMessageId,
      result.materialization.wireInternetMessageId,
    );
    assert.notEqual(
      result.materialization.rfcMessageId,
      result.materialization.wireInternetMessageId,
    );

    const threads = await db
      .select()
      .from(schema.mailThreads)
      .where(eq(schema.mailThreads.mailboxId, mailboxId));
    assert.equal(
      threads.filter((thread) => thread.id.startsWith(FIXTURE)).length,
      1,
    );
  });

  it("forward creates new thread with null canonical reply_to and no RFC headers", async () => {
    const sourceId = `${FIXTURE}-source-forward`;
    const sourceThreadId = `${FIXTURE}-thread-forward`;
    await insertInboundSource(db, {
      id: sourceId,
      mailboxId,
      threadId: sourceThreadId,
    });

    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: sourceId,
      mode: "forward",
      folder: "inbox",
    });
    const withRecipient = await addForwardRecipient(db, draft);
    const result = await materializeSeededDraft(
      db,
      withRecipient.id,
      withRecipient.autosaveVersion,
    );

    assert.notEqual(result.threadId, sourceThreadId);
    assert.equal(result.message.composeMode, "forward");
    assert.equal(result.message.replyToMessageId, null);
    assert.equal(result.message.inReplyTo, null);
    assert.equal(result.message.referencesHeader, null);
    assert.ok(result.message.internetMessageId);

    const threads = await db
      .select()
      .from(schema.mailThreads)
      .where(eq(schema.mailThreads.mailboxId, mailboxId));
    assert.equal(
      threads.filter((thread) => thread.id.startsWith(FIXTURE)).length,
      2,
    );
  });

  it("cross-mailbox reply creates outbound mailbox thread with RFC lineage", async () => {
    const sourceAddress = fixtureAddress("source-only-mailbox");
    const sourceMailbox = await createMailbox(db, adminActor, {
      address: sourceAddress,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });
    const now = new Date().toISOString();
    await db.insert(schema.mailMailboxMembers).values({
      id: `${FIXTURE}-source-reader`,
      mailboxId: sourceMailbox.id,
      userId: SEED_IDS.staffA,
      canRead: 1,
      canReply: 1,
      canSend: 0,
      canAssign: 0,
      canManageProcessing: 0,
      canAddInternalNote: 0,
      grantedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    const sourceId = `${FIXTURE}-cross-source`;
    const sourceThreadId = `${FIXTURE}-cross-thread`;
    await insertInboundSource(db, {
      id: sourceId,
      mailboxId: sourceMailbox.id,
      threadId: sourceThreadId,
      internetMessageId: "<cross-source@example.com>",
    });

    const outboundMailbox = await setupMailboxWithIdentity(db, "outbound-mailbox");
    const seeded = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: sourceId,
      mode: "reply",
      folder: "inbox",
    });
    const withOutboundIdentity = await updateDraft(db, staffActor, {
      draftId: seeded.id,
      expectedAutosaveVersion: seeded.autosaveVersion,
      senderIdentityId: outboundMailbox.identity.id,
      mailboxId: outboundMailbox.mailbox.id,
    });
    const revision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: withOutboundIdentity.id,
      expectedAutosaveVersion: withOutboundIdentity.autosaveVersion,
    });
    assert.equal(revision.composeMode, "reply");

    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });
    await approveRevision(db, approvalActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });
    const initiated = await initiateStaffApprovedSend(db, approvalActor, {
      revisionId: revision.id,
      idempotencyKey: `${FIXTURE}-cross-${revision.id}`,
    });
    const providerMessageId = fixtureProviderMessageId(revision.id);
    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "accepted",
      providerRequestId: "req",
      providerMessageId,
    });
    await dispatchSendOperation(db, approvalActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    const result = await materializeAcceptedOutboundSend(db, initiated.id);

    assert.notEqual(result.threadId, sourceThreadId);
    assert.equal(result.mailboxId, outboundMailbox.mailbox.id);
    assert.equal(result.message.replyToMessageId, sourceId);
    assert.equal(result.message.inReplyTo, "<cross-source@example.com>");
    assert.equal(result.message.mailboxId, outboundMailbox.mailbox.id);
  });

  it("rejects reply revision missing source provenance at materialization", async () => {
    const sourceId = `${FIXTURE}-orphan-source`;
    const threadId = `${FIXTURE}-orphan-thread`;
    await insertInboundSource(db, {
      id: sourceId,
      mailboxId,
      threadId,
      internetMessageId: "<orphan-source@example.com>",
    });
    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: sourceId,
      mode: "reply",
      folder: "inbox",
    });
    const revision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });
    await approveRevision(db, approvalActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });
    const initiated = await initiateStaffApprovedSend(db, approvalActor, {
      revisionId: revision.id,
      idempotencyKey: `${FIXTURE}-orphan-${revision.id}`,
    });
    const providerMessageId = fixtureProviderMessageId(revision.id);
    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "accepted",
      providerRequestId: "req",
      providerMessageId,
    });
    await dispatchSendOperation(db, approvalActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    await db
      .update(schema.mailOutboundRevisions)
      .set({ composeMode: "reply", replyToMessageId: null })
      .where(eq(schema.mailOutboundRevisions.id, revision.id));

    await assert.rejects(
      () => materializeAcceptedOutboundSend(db, initiated.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("inbound round-trip resolves outbound reply Message-ID to thread", async () => {
    const sourceId = `${FIXTURE}-roundtrip-source`;
    const threadId = `${FIXTURE}-roundtrip-thread`;
    await insertInboundSource(db, {
      id: sourceId,
      mailboxId,
      threadId,
      internetMessageId: "<roundtrip-source@example.com>",
    });
    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: sourceId,
      mode: "reply",
      folder: "inbox",
    });
    const result = await materializeSeededDraft(db, draft.id, draft.autosaveVersion);
    const outboundMessageId = result.message.internetMessageId;
    assert.ok(outboundMessageId);

    const resolution = await resolveInboundThread(db, {
      mailboxId,
      inReplyTo: outboundMessageId,
      referencesHeader: null,
    });
    assert.equal(resolution.createThread, false);
    assert.equal(resolution.threadId, threadId);
    assert.equal(resolution.replyToMessageId, result.message.id);
  });

  it("materialization retry is idempotent for reply", async () => {
    const sourceId = `${FIXTURE}-idempotent-source`;
    const threadId = `${FIXTURE}-idempotent-thread`;
    await insertInboundSource(db, {
      id: sourceId,
      mailboxId,
      threadId,
      internetMessageId: "<idempotent-source@example.com>",
    });
    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: sourceId,
      mode: "reply",
      folder: "inbox",
    });
    const revision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });
    await approveRevision(db, approvalActor, {
      approvalId: approval.id,
      expectedWorkflowVersion: 1,
    });
    const initiated = await initiateStaffApprovedSend(db, approvalActor, {
      revisionId: revision.id,
      idempotencyKey: `${FIXTURE}-idem-${revision.id}`,
    });
    const providerMessageId = fixtureProviderMessageId(revision.id);
    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "accepted",
      providerRequestId: "req",
      providerMessageId,
    });
    await dispatchSendOperation(db, approvalActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    const first = await materializeAcceptedOutboundSend(db, initiated.id);
    const second = await materializeAcceptedOutboundSend(db, initiated.id);
    assert.equal(first.message.id, second.message.id);
    assert.equal(first.materialization.id, second.materialization.id);
    assert.equal(first.threadId, threadId);
    assert.equal(second.threadId, threadId);
    const [thread] = await db
      .select()
      .from(schema.mailThreads)
      .where(eq(schema.mailThreads.id, threadId))
      .limit(1);
    assert.ok(thread);
  });
});

describe("transport threading serialization", () => {
  it("reply submission includes In-Reply-To and References in renderer", () => {
    const submission = {
      sendOperationId: "send-1",
      transportAttemptId: "attempt-1",
      outboundRevisionId: "rev-1",
      rfcMessageId: "<outbound@example.com>",
      fromAddress: "staff@echfronthk.com",
      fromDisplayName: null,
      subject: "Re: Hello",
      bodyText: "Body",
      bodyHtmlSanitized: null,
      signatureBodyText: null,
      signatureBodyHtmlSanitized: null,
      signatureAssets: [],
      recipients: [{ type: "to", address: "client@example.com", displayName: null }],
      attachments: [],
      inReplyTo: "<source@example.com>",
      referencesHeader: "<source@example.com>",
    };
    const request = buildCloudflareEmailOutboundSendRequestForTest(submission);
    assert.equal(request.headers?.["Message-ID"], undefined);
    assert.equal(request.headers?.["In-Reply-To"], "<source@example.com>");
    assert.equal(request.headers?.References, "<source@example.com>");
  });

  it("forward submission omits custom Message-ID and threading headers", () => {
    const submission = {
      sendOperationId: "send-2",
      transportAttemptId: "attempt-2",
      outboundRevisionId: "rev-2",
      rfcMessageId: "<fwd@example.com>",
      fromAddress: "staff@echfronthk.com",
      fromDisplayName: null,
      subject: "Fwd: Hello",
      bodyText: "Body",
      bodyHtmlSanitized: null,
      signatureBodyText: null,
      signatureBodyHtmlSanitized: null,
      signatureAssets: [],
      recipients: [],
      attachments: [],
      inReplyTo: null,
      referencesHeader: null,
    };
    const request = buildCloudflareEmailOutboundSendRequestForTest(submission);
    assert.equal(request.headers?.["Message-ID"], undefined);
    assert.equal(request.headers?.["In-Reply-To"], undefined);
    assert.equal(request.headers?.References, undefined);
  });
});
