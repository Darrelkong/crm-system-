import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import {
  buildReplaceCustomerIdentifierStatements,
  loadSecondaryContactsForCustomer,
} from "@/lib/customers/contact-identifiers";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  addDraftRecipient,
  createDraft,
  updateDraft,
} from "@/lib/mail/draft-service";
import { createOutboundRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  activateSignatureVersion,
  createSignatureVersion,
} from "@/lib/mail/signature-service";
import { getMessageDetail } from "@/lib/mail/mail-read-service";
import { resolveMessageCustomerAssociation } from "@/lib/mail/mail-customer-context-resolver";
import { MAIL_CRM_CONTEXT_SAFE_FIELD_KEYS } from "@/lib/mail/crm/mail-crm-context-model";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-crm-context-4a";

const STAFF_A_CUSTOMER_EMAIL = "staff-a-customer@example.com";
const STAFF_B_CUSTOMER_EMAIL = "staff-b-customer@example.com";
const POOL_CUSTOMER_EMAIL = "pool-customer@example.com";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  options: {
    crmRole?: "admin" | "staff";
    adminGrants?: MailAdminPermission[];
  } = {},
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole:
      options.crmRole ?? (userId === SEED_IDS.admin ? "admin" : "staff"),
    mailAccessEnabled: true,
    adminGrants: options.adminGrants ?? [],
    audit: { ipAddress: "127.0.0.1", userAgent: "mail-crm-context-4a-test" },
  };
}

const setupAdminActor = actor(SEED_IDS.admin, {
  adminGrants: ["account_mgmt", "address_assignment", "signature_template"],
});
const adminActor = actor(SEED_IDS.admin);
const staffA = actor(SEED_IDS.staffA);
const staffB = actor(SEED_IDS.staffB);

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function assertSafeAssociationShape(
  association: Record<string, unknown> | null,
): void {
  assert.ok(association);
  assert.deepEqual(Object.keys(association).sort(), [
    ...MAIL_CRM_CONTEXT_SAFE_FIELD_KEYS,
  ].sort());
  assert.equal("phone" in association, false);
  assert.equal("email" in association, false);
  assert.equal("wechatId" in association, false);
  assert.equal("notes" in association, false);
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

  if (mailboxIds.length) {
    const messages = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(inArray(schema.mailMessages.mailboxId, mailboxIds));
    const messageIds = messages.map((row) => row.id);

    if (messageIds.length) {
      await db
        .delete(schema.mailOutboundMessageMaterializations)
        .where(
          inArray(
            schema.mailOutboundMessageMaterializations.mailMessageId,
            messageIds,
          ),
        );
      await db
        .delete(schema.mailMessageAttachments)
        .where(inArray(schema.mailMessageAttachments.messageId, messageIds));
      await db
        .delete(schema.mailMessageRecipients)
        .where(inArray(schema.mailMessageRecipients.messageId, messageIds));
      await db
        .delete(schema.mailMessageReadStates)
        .where(inArray(schema.mailMessageReadStates.messageId, messageIds));
      await db
        .delete(schema.mailMessageBodies)
        .where(inArray(schema.mailMessageBodies.messageId, messageIds));
      await db
        .delete(schema.mailMessages)
        .where(inArray(schema.mailMessages.id, messageIds));
    }

    const threads = await db
      .select({ id: schema.mailThreads.id })
      .from(schema.mailThreads)
      .where(inArray(schema.mailThreads.mailboxId, mailboxIds));
    if (threads.length) {
      await db
        .delete(schema.mailThreads)
        .where(inArray(schema.mailThreads.id, threads.map((row) => row.id)));
    }
  }

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
      .where(
        inArray(schema.mailOutboundRevisionAttachments.revisionId, revisionIds),
      );
    await db
      .delete(schema.mailOutboundRevisionRecipients)
      .where(
        inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds),
      );
    await db
      .delete(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.id, revisionIds));
  }

  if (snapshotIds.length) {
    await db
      .delete(schema.mailSignatureSnapshotAssets)
      .where(
        inArray(
          schema.mailSignatureSnapshotAssets.signatureSnapshotId,
          snapshotIds,
        ),
      );
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
      .where(
        inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds),
      );
    await db
      .delete(schema.mailSignatureVersions)
      .where(
        inArray(schema.mailSignatureVersions.senderIdentityId, identityIds),
      );
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

async function setupPersonalMailbox(db: TestDb, ownerUserId: string) {
  const address = fixtureAddress(`personal-${ownerUserId.slice(0, 8)}`);
  const mailbox = await createMailbox(db, setupAdminActor, {
    address,
    mailboxType: "personal",
    ownerUserId,
  });
  const now = new Date().toISOString();
  await db
    .update(schema.mailMailboxMembers)
    .set({ canRead: 1, canReply: 1, canSend: 1, updatedAt: now })
    .where(
      and(
        eq(schema.mailMailboxMembers.mailboxId, mailbox.id),
        eq(schema.mailMailboxMembers.userId, ownerUserId),
      ),
    );
  return mailbox;
}

async function setupSharedMailboxWithMember(
  db: TestDb,
  memberUserId: string,
) {
  const address = fixtureAddress(`shared-${memberUserId.slice(0, 8)}`);
  const mailbox = await createMailbox(db, setupAdminActor, {
    address,
    mailboxType: "shared",
  });
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: `${FIXTURE}-member-${memberUserId}`,
    mailboxId: mailbox.id,
    userId: memberUserId,
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
  return mailbox;
}

async function insertInboundMessage(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    fromAddress: string;
    subject?: string;
  },
) {
  const now = new Date().toISOString();
  const threadId = `${input.id}-thread`;
  await db.insert(schema.mailThreads).values({
    id: threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: (input.subject ?? "Inbound").toLowerCase(),
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: "inbound",
    fromAddress: input.fromAddress,
    fromDisplayName: "Sender",
    subject: input.subject ?? "Inbound",
    previewText: "Preview",
    receivedAt: now,
    sentAt: null,
    trashedAt: null,
    composeMode: null,
    senderIdentityId: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: "Inbound body",
    bodyHtmlSanitized: "<p>Inbound body</p>",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageRecipients).values({
    id: `${input.id}-to`,
    messageId: input.id,
    recipientType: "to",
    address: "to@example.com",
    displayName: null,
    sortOrder: 0,
    createdAt: now,
  });
}

async function setupComposeFixture(db: TestDb, staffUserId: string) {
  const address = fixtureAddress(`compose-${staffUserId.slice(0, 8)}`);
  const mailbox = await createMailbox(db, setupAdminActor, {
    address,
    mailboxType: "personal",
    ownerUserId: staffUserId,
  });
  const identity = await createSenderIdentity(db, setupAdminActor, {
    address,
    defaultMailboxId: mailbox.id,
  });
  await grantSenderIdentityAccess(db, setupAdminActor, {
    senderIdentityId: identity.id,
    targetUserId: staffUserId,
    canSend: true,
  });
  const now = new Date().toISOString();
  await db
    .update(schema.mailMailboxMembers)
    .set({ canRead: 1, canReply: 1, canSend: 1, updatedAt: now })
    .where(
      and(
        eq(schema.mailMailboxMembers.mailboxId, mailbox.id),
        eq(schema.mailMailboxMembers.userId, staffUserId),
      ),
    );
  const version = await createSignatureVersion(db, setupAdminActor, {
    senderIdentityId: identity.id,
    bodyHtml: "<p>Sig</p>",
  });
  await activateSignatureVersion(db, setupAdminActor, version.id);
  return { mailbox, identity };
}

async function linkRevisionToOutboundMessage(
  db: TestDb,
  input: {
    messageId: string;
    revision: {
      id: string;
      revisionChainId: string;
      contentHash: string;
      hashVersion: number;
      revisionKind: "staff_submit" | "staff_resubmit" | "admin_edit" | "admin_direct";
    };
  },
) {
  const now = new Date().toISOString();
  const sendOperationId = `${input.messageId}-send`;
  const attemptId = `${input.messageId}-attempt`;
  const rfcIdentityId = `${input.messageId}-rfc`;
  const materializationId = `${input.messageId}-mat`;
  const { revision } = input;

  let approvalId: string | null = null;
  let authorizationMode: "staff_approved" | "admin_direct" = "admin_direct";
  if (
    revision.revisionKind === "staff_submit" ||
    revision.revisionKind === "staff_resubmit" ||
    revision.revisionKind === "admin_edit"
  ) {
    approvalId = `${input.messageId}-approval`;
    authorizationMode = "staff_approved";
    await db.insert(schema.mailOutboundApprovals).values({
      id: approvalId,
      revisionChainId: revision.revisionChainId,
      status: "approved",
      priority: "normal",
      workflowVersion: 1,
      currentRevisionId: revision.id,
      currentContentHash: revision.contentHash,
      currentHashVersion: revision.hashVersion,
      approvedRevisionId: revision.id,
      approvedContentHash: revision.contentHash,
      approvedHashVersion: revision.hashVersion,
      requestedByUserId: SEED_IDS.staffA,
      requestedAt: now,
      resolvedByUserId: SEED_IDS.admin,
      resolvedAt: now,
      nextReminderAt: null,
    });
  }

  await db.insert(schema.mailSendOperations).values({
    id: sendOperationId,
    outboundRevisionId: revision.id,
    revisionChainId: revision.revisionChainId,
    contentHash: revision.contentHash,
    hashVersion: revision.hashVersion,
    revisionKind: revision.revisionKind,
    authorizationMode,
    approvalId,
    idempotencyKey: `${input.messageId}-idem`,
    status: "accepted",
    orchestrationVersion: 1,
    initiatedByUserId: SEED_IDS.staffA,
    createdAt: now,
    completedAt: now,
    nextAttemptAt: null,
  });

  await db.insert(schema.mailTransportAttempts).values({
    id: attemptId,
    sendOperationId,
    attemptNumber: 1,
    state: "accepted",
    provider: "fake",
    providerMessageId: `${input.messageId}-provider`,
    startedAt: now,
    completedAt: now,
  });

  await db.insert(schema.mailOutboundRfcIdentities).values({
    id: rfcIdentityId,
    sendOperationId,
    outboundRevisionId: revision.id,
    rfcMessageId: `${input.messageId}@echfront.local`,
    createdAt: now,
  });

  await db.insert(schema.mailOutboundMessageMaterializations).values({
    id: materializationId,
    sendOperationId,
    outboundRevisionId: revision.id,
    contentHash: revision.contentHash,
    hashVersion: revision.hashVersion,
    acceptedTransportAttemptId: attemptId,
    outboundRfcIdentityId: rfcIdentityId,
    rfcMessageId: `${input.messageId}@echfront.local`,
    wireInternetMessageId: null,
    mailMessageId: input.messageId,
    messageDirection: "outbound",
    materializedAt: now,
  });
}

describe("resolveMessageCustomerAssociation", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;

    for (const customerId of [
      SEED_IDS.customerStaffA,
      SEED_IDS.customerStaffB,
      SEED_IDS.customerPublicPool,
    ]) {
      const [customer] = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, customerId))
        .limit(1);
      if (!customer) continue;
      const secondaryContacts = await loadSecondaryContactsForCustomer(
        db,
        customerId,
      );
      const { statements } = buildReplaceCustomerIdentifierStatements(db, {
        customerId,
        phoneCountryCode: customer.phoneCountryCode,
        phone: customer.phone,
        wechatId: customer.wechatId,
        email: customer.email,
        secondaryContacts,
        now: new Date().toISOString(),
      });
      await db.batch(statements as [typeof statements[0], ...typeof statements]);
    }

    await enableMailAccess(db, SEED_IDS.admin);
    await enableMailAccess(db, SEED_IDS.staffA);
    await enableMailAccess(db, SEED_IDS.staffB);
    await cleanupFixtures(db);
  });

  after(async () => {
    try {
      await cleanupFixtures(db);
    } finally {
      bindTestDatabase(null);
      delete process.env.CRM_ALLOW_TEST_DB_BIND;
      await dispose?.();
    }
  });

  it("returns inbound auto_match association when actor has CRM access", async () => {
    await cleanupFixtures(db);
    const mailbox = await setupPersonalMailbox(db, SEED_IDS.staffA);
    const messageId = `${FIXTURE}-inbound-match`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      fromAddress: STAFF_A_CUSTOMER_EMAIL,
    });

    const detail = await getMessageDetail(db, staffA, messageId, {
      folder: "inbox",
    });
    assert.ok(detail.customerAssociation);
    assert.equal(detail.customerAssociation.customerId, SEED_IDS.customerStaffA);
    assert.equal(detail.customerAssociation.associationType, "auto_match");
    assertSafeAssociationShape(
      detail.customerAssociation as unknown as Record<string, unknown>,
    );
    await cleanupFixtures(db);
  });

  it("returns null for inbound exact match when actor lacks CRM access", async () => {
    await cleanupFixtures(db);
    const mailbox = await setupPersonalMailbox(db, SEED_IDS.staffB);
    const messageId = `${FIXTURE}-inbound-denied`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      fromAddress: STAFF_A_CUSTOMER_EMAIL,
    });

    const detail = await getMessageDetail(db, staffB, messageId, {
      folder: "inbox",
    });
    assert.equal(detail.customerAssociation, null);
    await cleanupFixtures(db);
  });

  it("returns null for unmatched inbound sender", async () => {
    await cleanupFixtures(db);
    const mailbox = await setupPersonalMailbox(db, SEED_IDS.staffA);
    const messageId = `${FIXTURE}-inbound-unmatched`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      fromAddress: "unknown-sender@example.com",
    });

    const detail = await getMessageDetail(db, staffA, messageId, {
      folder: "inbox",
    });
    assert.equal(detail.customerAssociation, null);
    await cleanupFixtures(db);
  });

  it("returns null for invalid inbound sender address", async () => {
    await cleanupFixtures(db);
    const mailbox = await setupPersonalMailbox(db, SEED_IDS.staffA);
    const messageId = `${FIXTURE}-inbound-invalid`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      fromAddress: "not-an-email",
    });

    const association = await resolveMessageCustomerAssociation(db, staffA, {
      id: messageId,
      direction: "inbound",
      fromAddress: "not-an-email",
      mailboxId: mailbox.id,
    });
    assert.equal(association, null);
    await cleanupFixtures(db);
  });

  it("returns null for public pool customer to unauthorized staff", async () => {
    await cleanupFixtures(db);
    const mailbox = await setupPersonalMailbox(db, SEED_IDS.staffA);
    const messageId = `${FIXTURE}-inbound-pool`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      fromAddress: POOL_CUSTOMER_EMAIL,
    });

    const detail = await getMessageDetail(db, staffA, messageId, {
      folder: "inbox",
    });
    assert.equal(detail.customerAssociation, null);
    await cleanupFixtures(db);
  });

  it("allows admin CRM access for public pool inbound match", async () => {
    await cleanupFixtures(db);
    const mailbox = await setupPersonalMailbox(db, SEED_IDS.admin);
    const messageId = `${FIXTURE}-inbound-pool-admin`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      fromAddress: POOL_CUSTOMER_EMAIL,
    });

    const detail = await getMessageDetail(db, adminActor, messageId, {
      folder: "inbox",
    });
    assert.ok(detail.customerAssociation);
    assert.equal(
      detail.customerAssociation.customerId,
      SEED_IDS.customerPublicPool,
    );
    await cleanupFixtures(db);
  });

  it("keeps mail readable but hides CRM for shared mailbox reader without access", async () => {
    await cleanupFixtures(db);
    const mailbox = await setupSharedMailboxWithMember(db, SEED_IDS.staffB);
    const messageId = `${FIXTURE}-shared-denied`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      fromAddress: STAFF_A_CUSTOMER_EMAIL,
    });

    const detail = await getMessageDetail(db, staffB, messageId, {
      folder: "inbox",
    });
    assert.equal(detail.bodyText, "Inbound body");
    assert.equal(detail.customerAssociation, null);
    await cleanupFixtures(db);
  });

  it("returns association for shared mailbox reader with CRM access to matched customer", async () => {
    await cleanupFixtures(db);
    const mailbox = await setupSharedMailboxWithMember(db, SEED_IDS.staffA);
    const messageId = `${FIXTURE}-shared-allowed`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      fromAddress: STAFF_A_CUSTOMER_EMAIL,
    });

    const detail = await getMessageDetail(db, staffA, messageId, {
      folder: "inbox",
    });
    assert.ok(detail.customerAssociation);
    assert.equal(detail.customerAssociation.customerId, SEED_IDS.customerStaffA);
    await cleanupFixtures(db);
  });

  it("does not elevate CRM access for global_mail_read", async () => {
    await cleanupFixtures(db);
    const mailbox = await setupPersonalMailbox(db, SEED_IDS.staffA);
    const messageId = `${FIXTURE}-global-read`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      fromAddress: STAFF_A_CUSTOMER_EMAIL,
    });

    const detail = await getMessageDetail(
      db,
      actor(SEED_IDS.staffB, { adminGrants: ["global_mail_read"] }),
      messageId,
      { folder: "inbox" },
    );
    assert.equal(detail.bodyText, "Inbound body");
    assert.equal(detail.customerAssociation, null);
    await cleanupFixtures(db);
  });

  it("does not elevate CRM access for mail admin grants", async () => {
    await cleanupFixtures(db);
    const mailbox = await setupSharedMailboxWithMember(db, SEED_IDS.staffB);
    const messageId = `${FIXTURE}-mail-admin`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      fromAddress: STAFF_A_CUSTOMER_EMAIL,
    });

    const detail = await getMessageDetail(
      db,
      actor(SEED_IDS.staffB, {
        adminGrants: ["account_mgmt", "permission_mgmt"],
      }),
      messageId,
      { folder: "inbox" },
    );
    assert.equal(detail.bodyText, "Inbound body");
    assert.equal(detail.customerAssociation, null);
    await cleanupFixtures(db);
  });

  it("returns manual outbound association when revision stores customer and actor has access", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db, SEED_IDS.staffA);
    const draft = await createDraft(db, staffA, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Outbound manual",
      bodyText: "Body",
    });
    assert.ok(draft.created);
    const draftItem = draft.item;
    const withRecipient = await addDraftRecipient(db, staffA, {
      draftId: draftItem.id,
      expectedAutosaveVersion: draftItem.autosaveVersion,
      recipientType: "to",
      address: STAFF_B_CUSTOMER_EMAIL,
    });
    const linked = await updateDraft(db, staffA, {
      draftId: draftItem.id,
      expectedAutosaveVersion: withRecipient.autosaveVersion,
      customerAssociation: {
        customerId: SEED_IDS.customerStaffA,
        associationType: "manual",
      },
    });
    assert.ok(linked.customerAssociation);
    const revision = await createOutboundRevisionFromDraft(db, staffA, {
      draftId: draftItem.id,
      expectedAutosaveVersion: linked.autosaveVersion,
    });

    const messageId = `${FIXTURE}-outbound-manual`;
    const now = new Date().toISOString();
    const threadId = `${messageId}-thread`;
    await db.insert(schema.mailThreads).values({
      id: threadId,
      mailboxId: mailbox.id,
      subjectNormalized: "outbound manual",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessages).values({
      id: messageId,
      threadId,
      mailboxId: mailbox.id,
      direction: "outbound",
      fromAddress: identity.address,
      fromDisplayName: "Sender",
      subject: "Outbound manual",
      previewText: "Preview",
      receivedAt: null,
      sentAt: now,
      trashedAt: null,
      composeMode: "new",
      senderIdentityId: identity.id,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessageBodies).values({
      messageId,
      bodyText: "Outbound body",
      bodyHtmlSanitized: "<p>Outbound body</p>",
      createdAt: now,
      updatedAt: now,
    });

    await linkRevisionToOutboundMessage(db, {
      messageId,
      revision,
    });

    const detail = await getMessageDetail(db, staffA, messageId, {
      folder: "sent",
    });
    assert.ok(detail.customerAssociation);
    assert.equal(detail.customerAssociation.customerId, SEED_IDS.customerStaffA);
    assert.equal(detail.customerAssociation.associationType, "manual");
    await cleanupFixtures(db);
  });

  it("returns null for outbound revision association when actor lacks CRM access", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db, SEED_IDS.staffA);
    const draft = await createDraft(db, staffA, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Outbound denied",
      bodyText: "Body",
    });
    assert.ok(draft.created);
    const draftItem = draft.item;
    const withRecipient = await addDraftRecipient(db, staffA, {
      draftId: draftItem.id,
      expectedAutosaveVersion: draftItem.autosaveVersion,
      recipientType: "to",
      address: "to@example.com",
    });
    const linkedDraft = await updateDraft(db, staffA, {
      draftId: draftItem.id,
      expectedAutosaveVersion: withRecipient.autosaveVersion,
      customerAssociation: {
        customerId: SEED_IDS.customerStaffA,
        associationType: "manual",
      },
    });
    const revision = await createOutboundRevisionFromDraft(db, staffA, {
      draftId: draftItem.id,
      expectedAutosaveVersion: linkedDraft.autosaveVersion,
    });

    const messageId = `${FIXTURE}-outbound-denied`;
    const now = new Date().toISOString();
    const threadId = `${messageId}-thread`;
    await db.insert(schema.mailThreads).values({
      id: threadId,
      mailboxId: mailbox.id,
      subjectNormalized: "outbound denied",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessages).values({
      id: messageId,
      threadId,
      mailboxId: mailbox.id,
      direction: "outbound",
      fromAddress: identity.address,
      fromDisplayName: "Sender",
      subject: "Outbound denied",
      previewText: "Preview",
      receivedAt: null,
      sentAt: now,
      trashedAt: null,
      composeMode: "new",
      senderIdentityId: identity.id,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessageBodies).values({
      messageId,
      bodyText: "Outbound body",
      bodyHtmlSanitized: null,
      createdAt: now,
      updatedAt: now,
    });
    await linkRevisionToOutboundMessage(db, {
      messageId,
      revision,
    });

    const readerMemberNow = new Date().toISOString();
    await db.insert(schema.mailMailboxMembers).values({
      id: `${FIXTURE}-outbound-denied-reader`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffB,
      canRead: 1,
      canReply: 0,
      canSend: 0,
      canAssign: 0,
      canManageProcessing: 0,
      canAddInternalNote: 0,
      grantedBy: SEED_IDS.admin,
      createdAt: readerMemberNow,
      updatedAt: readerMemberNow,
    });

    const detail = await getMessageDetail(db, staffB, messageId, {
      folder: "sent",
    });
    assert.equal(detail.customerAssociation, null);
    await cleanupFixtures(db);
  });

  it("returns null for outbound message without materialization linkage", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db, SEED_IDS.staffA);
    const messageId = `${FIXTURE}-outbound-no-mat`;
    const now = new Date().toISOString();
    const threadId = `${messageId}-thread`;
    await db.insert(schema.mailThreads).values({
      id: threadId,
      mailboxId: mailbox.id,
      subjectNormalized: "outbound no mat",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessages).values({
      id: messageId,
      threadId,
      mailboxId: mailbox.id,
      direction: "outbound",
      fromAddress: identity.address,
      fromDisplayName: "Sender",
      subject: "Outbound no mat",
      previewText: "Preview",
      receivedAt: null,
      sentAt: now,
      trashedAt: null,
      composeMode: "new",
      senderIdentityId: identity.id,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessageBodies).values({
      messageId,
      bodyText: "Outbound body",
      bodyHtmlSanitized: null,
      createdAt: now,
      updatedAt: now,
    });

    const association = await resolveMessageCustomerAssociation(db, staffA, {
      id: messageId,
      direction: "outbound",
      fromAddress: identity.address,
      mailboxId: mailbox.id,
    });
    assert.equal(association, null);
    await cleanupFixtures(db);
  });

  it("prefers stored outbound revision association over sender email inference", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db, SEED_IDS.staffA);
    const draft = await createDraft(db, staffA, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Outbound precedence",
      bodyText: "Body",
    });
    assert.ok(draft.created);
    const draftItem = draft.item;
    const withRecipient = await addDraftRecipient(db, staffA, {
      draftId: draftItem.id,
      expectedAutosaveVersion: draftItem.autosaveVersion,
      recipientType: "to",
      address: "to@example.com",
    });
    const linkedDraft = await updateDraft(db, staffA, {
      draftId: draftItem.id,
      expectedAutosaveVersion: withRecipient.autosaveVersion,
      customerAssociation: {
        customerId: SEED_IDS.customerStaffA,
        associationType: "auto_match",
      },
    });
    const revision = await createOutboundRevisionFromDraft(db, staffA, {
      draftId: draftItem.id,
      expectedAutosaveVersion: linkedDraft.autosaveVersion,
    });

    const messageId = `${FIXTURE}-outbound-precedence`;
    const now = new Date().toISOString();
    const threadId = `${messageId}-thread`;
    await db.insert(schema.mailThreads).values({
      id: threadId,
      mailboxId: mailbox.id,
      subjectNormalized: "outbound precedence",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessages).values({
      id: messageId,
      threadId,
      mailboxId: mailbox.id,
      direction: "outbound",
      fromAddress: STAFF_B_CUSTOMER_EMAIL,
      fromDisplayName: "Would match B inbound",
      subject: "Outbound precedence",
      previewText: "Preview",
      receivedAt: null,
      sentAt: now,
      trashedAt: null,
      composeMode: "new",
      senderIdentityId: identity.id,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessageBodies).values({
      messageId,
      bodyText: "Outbound body",
      bodyHtmlSanitized: null,
      createdAt: now,
      updatedAt: now,
    });
    await linkRevisionToOutboundMessage(db, {
      messageId,
      revision,
    });

    const detail = await getMessageDetail(db, staffA, messageId, {
      folder: "sent",
    });
    assert.ok(detail.customerAssociation);
    assert.equal(detail.customerAssociation.customerId, SEED_IDS.customerStaffA);
    assert.equal(detail.customerAssociation.associationType, "auto_match");
    await cleanupFixtures(db);
  });
});
