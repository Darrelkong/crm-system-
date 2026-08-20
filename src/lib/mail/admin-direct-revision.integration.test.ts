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
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import { createMailbox } from "@/lib/mail/mailbox-service";
import {
  createAdminDirectRevisionFromDraft,
  createOutboundRevisionFromDraft,
  recomputeOutboundRevisionContentHash,
} from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  dispatchSendOperation,
  initiateAdminDirectSend,
} from "@/lib/mail/send-operation-service";
import { FakeMailTransportAdapter } from "@/lib/mail/transport/fake-mail-transport-adapter";

const FIXTURE = "mail-phase2c71";

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
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c71-test" },
  };
}

const setupAdminActor = actor(SEED_IDS.admin, [
  "account_mgmt",
  "address_assignment",
  "signature_template",
]);
const staffActor = actor(SEED_IDS.staffA, []);
const superAdminStaffActor = actor(SEED_IDS.staffA, ["super_admin"]);
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
  const revisionIds = revisions.map((row) => row.id);
  const chainIds = [...new Set(revisions.map((row) => row.chainId))];

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

async function createSendReadyDraft(
  db: TestDb,
  actorCtx: MailActorContext,
  mailboxId: string,
  identityId: string,
): Promise<DraftDetailView> {
  const created = await createDraft(db, actorCtx, {
    senderIdentityId: identityId,
    mailboxId,
    subject: "Admin direct subject",
    bodyText: "Admin direct body",
  });
  assert.ok(created.created);
  return addDraftRecipient(db, actorCtx, {
    draftId: created.item.id,
    expectedAutosaveVersion: created.item.autosaveVersion,
    recipientType: "to",
    address: "client@example.com",
  });
}

describe("admin-direct revision from draft integration", () => {
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
    await cleanupFixtures(db);
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
  });

  it("production full flow: admin draft → admin_direct revision → send accepted", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupAdminComposeFixture(db);
    const draft = await createSendReadyDraft(db, adminActor, mailbox.id, identity.id);

    const revision = await createAdminDirectRevisionFromDraft(db, adminActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });
    assert.equal(revision.revisionKind, "admin_direct");
    assert.equal(revision.createdByUserId, SEED_IDS.admin);
    assert.ok(revision.signatureSnapshotId);
    assert.equal(revision.sourceDraftId, draft.id);

    const recomputed = await recomputeOutboundRevisionContentHash(db, revision.id);
    assert.equal(recomputed.contentHash, revision.contentHash);
    assert.equal(recomputed.hashVersion, revision.hashVersion);

    const approvals = await db
      .select()
      .from(schema.mailOutboundApprovals)
      .where(eq(schema.mailOutboundApprovals.revisionChainId, revision.revisionChainId));
    assert.equal(approvals.length, 0);

    const sendsBefore = await db.select().from(schema.mailSendOperations);
    assert.equal(sendsBefore.length, 0);

    const initiated = await initiateAdminDirectSend(db, adminActor, {
      revisionId: revision.id,
      idempotencyKey: `${FIXTURE}-full-flow`,
    });
    assert.equal(initiated.authorizationMode, "admin_direct");
    assert.ok(initiated.rfcIdentity?.rfcMessageId);

    const adapter = new FakeMailTransportAdapter().setBehavior({
      outcome: "accepted",
      providerRequestId: "flow-req",
      providerMessageId: "flow-msg",
    });
    const result = await dispatchSendOperation(db, adminActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    assert.equal(result.status, "accepted");

    const materializations = await db
      .select()
      .from(schema.mailOutboundMessageMaterializations);
    assert.equal(materializations.length, 0);
  });

  it("staff cannot create admin_direct revision", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupStaffComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);

    await assert.rejects(
      () =>
        createAdminDirectRevisionFromDraft(db, staffActor, {
          draftId: draft.id,
          expectedAutosaveVersion: draft.autosaveVersion,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
  });

  it("mail super_admin staff cannot create admin_direct revision", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupStaffComposeFixture(db);
    const draft = await createSendReadyDraft(
      db,
      staffActor,
      mailbox.id,
      identity.id,
    );

    await assert.rejects(
      () =>
        createAdminDirectRevisionFromDraft(db, superAdminStaffActor, {
          draftId: draft.id,
          expectedAutosaveVersion: draft.autosaveVersion,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
  });

  it("admin cannot convert staff draft to admin_direct", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupStaffComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);

    await assert.rejects(
      () =>
        createAdminDirectRevisionFromDraft(db, adminActor, {
          draftId: draft.id,
          expectedAutosaveVersion: draft.autosaveVersion,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
  });

  it("staff revision from same draft remains staff_submit", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupStaffComposeFixture(db);
    const draft = await createSendReadyDraft(db, staffActor, mailbox.id, identity.id);
    const revision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });
    assert.equal(revision.revisionKind, "staff_submit");
  });

  it("records revision audit with revisionKind metadata", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupAdminComposeFixture(db);
    const draft = await createSendReadyDraft(db, adminActor, mailbox.id, identity.id);
    const revision = await createAdminDirectRevisionFromDraft(db, adminActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });

    const audits = await db
      .select({ action: schema.auditLogs.action, metadata: schema.auditLogs.metadata })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, revision.id));
    assert.ok(audits.some((row) => row.action === MAIL_AUDIT_ACTIONS.revisionCreated));
    const meta = audits.find((row) => row.action === MAIL_AUDIT_ACTIONS.revisionCreated);
    assert.ok(meta?.metadata?.includes("admin_direct"));
  });
});
