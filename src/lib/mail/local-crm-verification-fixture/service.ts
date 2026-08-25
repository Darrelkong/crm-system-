import { and, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, releaseTestDatabase, type Database } from "@/lib/db";
import { buildReplaceCustomerIdentifierStatements } from "@/lib/customers/contact-identifiers";
import { assertFixtureAddressesDoNotCollideWithCrmContacts } from "@/lib/mail/local-verification-fixture/collision";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  crmFixtureSubject,
  crmFixtureTimestamp,
  LOCAL_MAIL_CRM_VERIFY_ADDRESSES,
  LOCAL_MAIL_CRM_VERIFY_CUSTOMER_CODES,
  LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS,
  LOCAL_MAIL_CRM_VERIFY_FIXTURE_ACTORS,
  LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX,
  LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS,
  LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS,
  LOCAL_MAIL_CRM_VERIFY_SENDER_IDENTITY_ID,
} from "@/lib/mail/local-crm-verification-fixture/constants";
import {
  assertLocalMailCrmVerifyFixtureAllowed,
  type LocalMailCrmVerifyCliTarget,
} from "@/lib/mail/local-crm-verification-fixture/guard";
import { getMessageDetail } from "@/lib/mail/mail-read-service";
import { lookupMailCustomerByEmail } from "@/lib/mail/mail-customer-lookup-service";
import { resolveMessageCustomerAssociation } from "@/lib/mail/mail-customer-context-resolver";
import { getUserById } from "@/lib/users/queries";

function fixtureLikePattern(): string {
  return `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}%`;
}

function mailActor(userId: string): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: [],
    audit: {
      ipAddress: "127.0.0.1",
      userAgent: "local-mail-crm-verify-2h4b2",
    },
  };
}

export async function connectLocalCrmVerificationFixtureDb(
  target: LocalMailCrmVerifyCliTarget,
): Promise<{ db: Database; dispose: () => Promise<void> }> {
  assertLocalMailCrmVerifyFixtureAllowed(target);
  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const proxy = await getPlatformProxy<{ DB: unknown }>({
    configPath: "wrangler.jsonc",
  });
  const db = drizzle(proxy.env.DB, { schema }) as unknown as Database;
  bindTestDatabase(db);
  return {
    db,
    dispose: async () => {
      releaseTestDatabase(db);
      await proxy.dispose();
    },
  };
}

async function enableMailAccess(db: Database, userId: string, now: string) {
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

async function insertMailboxMember(
  db: Database,
  input: {
    id: string;
    mailboxId: string;
    userId: string;
  },
  now: string,
) {
  await db.insert(schema.mailMailboxMembers).values({
    id: input.id,
    mailboxId: input.mailboxId,
    userId: input.userId,
    canRead: 1,
    canReply: 0,
    canSend: 0,
    canAssign: 0,
    canManageProcessing: 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertInboundMessage(
  db: Database,
  input: {
    id: string;
    mailboxId: string;
    subject: string;
    fromAddress: string;
    bodyText: string;
    receivedAt: string;
  },
  now: string,
) {
  const threadId = `${input.id}-THREAD`;
  await db.insert(schema.mailThreads).values({
    id: threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: input.subject.toLowerCase(),
    lastMessageAt: input.receivedAt,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: "inbound",
    senderIdentityId: null,
    fromAddress: input.fromAddress,
    fromDisplayName: "Local CRM Verify Sender",
    subject: input.subject,
    subjectNormalized: input.subject.toLowerCase(),
    previewText: input.bodyText.slice(0, 120),
    receivedAt: input.receivedAt,
    sentAt: null,
    trashedAt: null,
    composeMode: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: input.bodyText,
    bodyHtmlSanitized: null,
    quotedText: null,
    quotedHtmlSanitized: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageRecipients).values({
    id: `${input.id}-TO`,
    messageId: input.id,
    recipientType: "to",
    address: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.toRecipient,
    displayName: null,
    sortOrder: 0,
    createdAt: now,
  });
}

async function linkOutboundRevisionToMessage(
  db: Database,
  input: {
    messageId: string;
    revisionId: string;
    revisionChainId: string;
    contentHash: string;
    hashVersion: number;
    revisionKind: "admin_direct";
  },
  now: string,
) {
  const sendOperationId = `${input.messageId}-SEND`;
  const attemptId = `${input.messageId}-ATTEMPT`;
  const rfcIdentityId = `${input.messageId}-RFC`;
  const materializationId = `${input.messageId}-MAT`;

  await db.insert(schema.mailSendOperations).values({
    id: sendOperationId,
    outboundRevisionId: input.revisionId,
    revisionChainId: input.revisionChainId,
    contentHash: input.contentHash,
    hashVersion: input.hashVersion,
    revisionKind: input.revisionKind,
    authorizationMode: "admin_direct",
    approvalId: null,
    idempotencyKey: `${input.messageId}-IDEM`,
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
    providerMessageId: `${input.messageId}-PROVIDER`,
    startedAt: now,
    completedAt: now,
  });

  await db.insert(schema.mailOutboundRfcIdentities).values({
    id: rfcIdentityId,
    sendOperationId,
    outboundRevisionId: input.revisionId,
    rfcMessageId: `${input.messageId}@echfront.local`,
    createdAt: now,
  });

  await db.insert(schema.mailOutboundMessageMaterializations).values({
    id: materializationId,
    sendOperationId,
    outboundRevisionId: input.revisionId,
    contentHash: input.contentHash,
    hashVersion: input.hashVersion,
    acceptedTransportAttemptId: attemptId,
    outboundRfcIdentityId: rfcIdentityId,
    rfcMessageId: `${input.messageId}@echfront.local`,
    wireInternetMessageId: null,
    mailMessageId: input.messageId,
    messageDirection: "outbound",
    materializedAt: now,
  });
}

export async function cleanupLocalMailCrmVerificationFixtures(
  db: Database,
): Promise<{
  deletedMessageCount: number;
  deletedCustomerCount: number;
  deletedMailboxCount: number;
}> {
  const pattern = fixtureLikePattern();
  const customerIds = Object.values(LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS);

  const fixtureMailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.id, pattern));
  const mailboxIds = fixtureMailboxes.map((row) => row.id);

  const fixtureMessagesById = await db
    .select({ id: schema.mailMessages.id })
    .from(schema.mailMessages)
    .where(like(schema.mailMessages.id, pattern));
  const fixtureMessagesByMailbox =
    mailboxIds.length > 0
      ? await db
          .select({ id: schema.mailMessages.id })
          .from(schema.mailMessages)
          .where(inArray(schema.mailMessages.mailboxId, mailboxIds))
      : [];
  const messageIds = [
    ...new Set([
      ...fixtureMessagesById.map((row) => row.id),
      ...fixtureMessagesByMailbox.map((row) => row.id),
    ]),
  ];

  if (messageIds.length > 0) {
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
      .delete(schema.mailMessageReadStates)
      .where(inArray(schema.mailMessageReadStates.messageId, messageIds));
    await db
      .delete(schema.mailMessageBodies)
      .where(inArray(schema.mailMessageBodies.messageId, messageIds));
    await db
      .delete(schema.mailMessages)
      .where(inArray(schema.mailMessages.id, messageIds));
  }

  const revisions = await db
    .select({
      id: schema.mailOutboundRevisions.id,
      chainId: schema.mailOutboundRevisions.revisionChainId,
      snapshotId: schema.mailOutboundRevisions.signatureSnapshotId,
    })
    .from(schema.mailOutboundRevisions)
    .where(like(schema.mailOutboundRevisions.id, pattern));
  const revisionIds = revisions.map((row) => row.id);
  const chainIds = [...new Set(revisions.map((row) => row.chainId))];
  const snapshotIds = [...new Set(revisions.map((row) => row.snapshotId))];

  const sendOps =
    revisionIds.length > 0
      ? await db
          .select({ id: schema.mailSendOperations.id })
          .from(schema.mailSendOperations)
          .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds))
      : [];
  const sendIds = sendOps.map((row) => row.id);

  if (sendIds.length > 0) {
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

  if (chainIds.length > 0) {
    await db
      .delete(schema.mailOutboundApprovalEvents)
      .where(inArray(schema.mailOutboundApprovalEvents.revisionChainId, chainIds));
    await db
      .delete(schema.mailOutboundApprovals)
      .where(inArray(schema.mailOutboundApprovals.revisionChainId, chainIds));
  }

  if (revisionIds.length > 0) {
    await db
      .delete(schema.mailOutboundRevisionRecipients)
      .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds));
    await db
      .delete(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.id, revisionIds));
  }

  if (snapshotIds.length > 0) {
    await db
      .delete(schema.mailSignatureSnapshotAssets)
      .where(inArray(schema.mailSignatureSnapshotAssets.signatureSnapshotId, snapshotIds));
    await db
      .delete(schema.mailSignatureSnapshots)
      .where(inArray(schema.mailSignatureSnapshots.id, snapshotIds));
  }

  const threadIds = [
    ...Object.values(LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS).map((id) => `${id}-THREAD`),
    ...(mailboxIds.length
      ? (
          await db
            .select({ id: schema.mailThreads.id })
            .from(schema.mailThreads)
            .where(inArray(schema.mailThreads.mailboxId, mailboxIds))
        ).map((row) => row.id)
      : []),
  ];
  if (threadIds.length > 0) {
    await db
      .delete(schema.mailThreads)
      .where(inArray(schema.mailThreads.id, [...new Set(threadIds)]));
  }

  await db
    .delete(schema.mailSenderIdentityGrants)
    .where(like(schema.mailSenderIdentityGrants.id, pattern));
  await db
    .delete(schema.mailSignatureVersions)
    .where(like(schema.mailSignatureVersions.id, pattern));
  await db
    .delete(schema.mailSenderIdentities)
    .where(
      or(
        like(schema.mailSenderIdentities.id, pattern),
        like(schema.mailSenderIdentities.address, "local-mail-crm-verify-2h4b2-%"),
      )!,
    );

  if (mailboxIds.length > 0) {
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

  if (customerIds.length > 0) {
    await db
      .delete(schema.customerContactIdentifiers)
      .where(inArray(schema.customerContactIdentifiers.customerId, customerIds));
    await db
      .delete(schema.customers)
      .where(inArray(schema.customers.id, customerIds));
  }

  return {
    deletedMessageCount: messageIds.length,
    deletedCustomerCount: customerIds.length,
    deletedMailboxCount: mailboxIds.length,
  };
}

async function upsertFixtureCustomers(db: Database, now: string) {
  await db.insert(schema.customers).values([
    {
      id: LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS.accessibleA,
      customerCode: LOCAL_MAIL_CRM_VERIFY_CUSTOMER_CODES.accessibleA,
      customerName: "LOCAL CRM VERIFY Customer A",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+852",
      phone: null,
      wechatId: null,
      email: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.customerAEmail,
      source: "local_fixture",
      salesStage: "interested",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.admin,
      updatedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS.publicPool,
      customerCode: LOCAL_MAIL_CRM_VERIFY_CUSTOMER_CODES.publicPool,
      customerName: "LOCAL CRM VERIFY Customer Public Pool",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+852",
      phone: null,
      wechatId: null,
      email: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.publicPoolEmail,
      source: "local_fixture",
      salesStage: "new_lead",
      ownerId: null,
      status: "public_pool",
      releaserUserId: SEED_IDS.staffA,
      releasedBy: SEED_IDS.staffA,
      poolEnteredAt: now,
      poolReason: "LOCAL_MAIL_CRM_VERIFY_2H4B2 fixture",
      createdBy: SEED_IDS.admin,
      updatedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS.outboundManual,
      customerCode: LOCAL_MAIL_CRM_VERIFY_CUSTOMER_CODES.outboundManual,
      customerName: "LOCAL CRM VERIFY Outbound Customer",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+852",
      phone: null,
      wechatId: null,
      email: null,
      source: "local_fixture",
      salesStage: "proposal",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.admin,
      updatedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  for (const customerId of customerIdsWithEmail()) {
    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1);
    if (!customer?.email) continue;
    const { statements } = buildReplaceCustomerIdentifierStatements(db, {
      customerId,
      phoneCountryCode: customer.phoneCountryCode,
      phone: customer.phone,
      wechatId: customer.wechatId,
      email: customer.email,
      secondaryContacts: [],
      now,
    });
    await db.batch(statements as [typeof statements[0], ...typeof statements]);
  }
}

function customerIdsWithEmail(): string[] {
  return [
    LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS.accessibleA,
    LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS.publicPool,
  ];
}

export async function setupLocalMailCrmVerificationFixtures(db: Database) {
  await cleanupLocalMailCrmVerificationFixtures(db);

  await assertFixtureAddressesDoNotCollideWithCrmContacts(db, [
    LOCAL_MAIL_CRM_VERIFY_ADDRESSES.customerAEmail,
    LOCAL_MAIL_CRM_VERIFY_ADDRESSES.publicPoolEmail,
    LOCAL_MAIL_CRM_VERIFY_ADDRESSES.externalNoMatchEmail,
    LOCAL_MAIL_CRM_VERIFY_ADDRESSES.sharedMailbox,
    LOCAL_MAIL_CRM_VERIFY_ADDRESSES.senderIdentity,
    LOCAL_MAIL_CRM_VERIFY_ADDRESSES.toRecipient,
  ]);

  const now = crmFixtureTimestamp(0);

  for (const userId of [
    LOCAL_MAIL_CRM_VERIFY_FIXTURE_ACTORS.admin,
    LOCAL_MAIL_CRM_VERIFY_FIXTURE_ACTORS.staffA,
    LOCAL_MAIL_CRM_VERIFY_FIXTURE_ACTORS.staffB,
  ]) {
    await enableMailAccess(db, userId, now);
  }

  await upsertFixtureCustomers(db, now);

  await db.insert(schema.mailMailboxes).values({
    id: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
    address: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.sharedMailbox,
    displayName: "Local CRM Verify Shared",
    mailboxType: "shared",
    status: "active",
    createdBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.mailReceivingAddresses).values({
    id: `${LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared}-PRIMARY`,
    mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
    address: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.sharedMailbox,
    addressType: "primary",
    status: "active",
    createdByUserId: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });

  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-MEMBER-A`,
      mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
      userId: SEED_IDS.staffA,
    },
    now,
  );
  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-MEMBER-B`,
      mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
      userId: SEED_IDS.staffB,
    },
    now,
  );
  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-MEMBER-ADMIN`,
      mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
      userId: SEED_IDS.admin,
    },
    now,
  );

  await db.insert(schema.mailSenderIdentities).values({
    id: LOCAL_MAIL_CRM_VERIFY_SENDER_IDENTITY_ID,
    address: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.senderIdentity,
    displayName: "Local CRM Verify Sender",
    defaultMailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
    status: "active",
    createdBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });

  await insertInboundMessage(
    db,
    {
      id: LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.accessibleCustomer,
      mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
      subject: crmFixtureSubject("Accessible Customer"),
      fromAddress: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.customerAEmail,
      bodyText: "Fixture inbound message for Staff A accessible CRM customer.",
      receivedAt: crmFixtureTimestamp(10),
    },
    now,
  );

  await insertInboundMessage(
    db,
    {
      id: LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.publicPoolCustomer,
      mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
      subject: crmFixtureSubject("Public Pool Customer"),
      fromAddress: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.publicPoolEmail,
      bodyText: "Fixture inbound message for Public Pool privacy verification.",
      receivedAt: crmFixtureTimestamp(9),
    },
    now,
  );

  await insertInboundMessage(
    db,
    {
      id: LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.externalNoMatch,
      mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
      subject: crmFixtureSubject("External No Match"),
      fromAddress: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.externalNoMatchEmail,
      bodyText: "Fixture inbound message with no CRM customer match.",
      receivedAt: crmFixtureTimestamp(8),
    },
    now,
  );

  const outboundMessageId = LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.outboundManual;
  const outboundSubject = crmFixtureSubject("Outbound Manual Association");
  const outboundThreadId = `${outboundMessageId}-THREAD`;
  const revisionId = `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-REVISION-OUTBOUND`;
  const revisionChainId = `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-REVISION-CHAIN`;
  const snapshotId = `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-SIG-SNAPSHOT`;
  const contentHash = "c".repeat(64);

  await db.insert(schema.mailThreads).values({
    id: outboundThreadId,
    mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
    subjectNormalized: outboundSubject.toLowerCase(),
    lastMessageAt: crmFixtureTimestamp(7),
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.mailMessages).values({
    id: outboundMessageId,
    threadId: outboundThreadId,
    mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
    direction: "outbound",
    senderIdentityId: LOCAL_MAIL_CRM_VERIFY_SENDER_IDENTITY_ID,
    fromAddress: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.senderIdentity,
    fromDisplayName: "Local CRM Verify Sender",
    subject: outboundSubject,
    subjectNormalized: outboundSubject.toLowerCase(),
    previewText: "Fixture outbound manual association message.",
    receivedAt: null,
    sentAt: crmFixtureTimestamp(7),
    trashedAt: null,
    composeMode: "new",
    createdBy: SEED_IDS.staffA,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.mailMessageBodies).values({
    messageId: outboundMessageId,
    bodyText: "Fixture outbound body with stored manual CRM association.",
    bodyHtmlSanitized: "<p>Fixture outbound body with stored manual CRM association.</p>",
    quotedText: null,
    quotedHtmlSanitized: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.mailSignatureSnapshots).values({
    id: snapshotId,
    senderIdentityId: LOCAL_MAIL_CRM_VERIFY_SENDER_IDENTITY_ID,
    sourceSignatureVersionId: null,
    bodyText: "",
    bodyHtmlSanitized: null,
    assetRefsJson: null,
    snapshotHash: "d".repeat(64),
    createdAt: now,
  });

  await db.insert(schema.mailOutboundRevisions).values({
    id: revisionId,
    revisionChainId,
    revisionNumber: 1,
    parentRevisionId: null,
    sourceDraftId: null,
    revisionKind: "admin_direct",
    createdByUserId: SEED_IDS.staffA,
    createdAt: now,
    mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
    senderIdentityId: LOCAL_MAIL_CRM_VERIFY_SENDER_IDENTITY_ID,
    fromAddress: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.senderIdentity,
    fromDisplayName: "Local CRM Verify Sender",
    subject: outboundSubject,
    bodyText: "Fixture outbound body with stored manual CRM association.",
    bodyHtmlSanitized: "<p>Fixture outbound body with stored manual CRM association.</p>",
    sensitivity: "normal",
    composeMode: "new",
    replyToMessageId: null,
    signatureSnapshotId: snapshotId,
    customerId: LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS.outboundManual,
    customerAssociationType: "manual",
    customerAssociatedByUserId: SEED_IDS.staffA,
    customerAssociatedAt: now,
    contentHash,
    hashVersion: 1,
  });

  await linkOutboundRevisionToMessage(
    db,
    {
      messageId: outboundMessageId,
      revisionId,
      revisionChainId,
      contentHash,
      hashVersion: 1,
      revisionKind: "admin_direct",
    },
    now,
  );

  return {
    mailboxIds: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS,
    customerIds: LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS,
    messageIds: LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS,
  };
}

export async function verifyLocalMailCrmVerificationFixtures(db: Database) {
  const messages = await db
    .select({ id: schema.mailMessages.id, subject: schema.mailMessages.subject })
    .from(schema.mailMessages)
    .where(like(schema.mailMessages.id, fixtureLikePattern()));

  const customers = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(inArray(schema.customers.id, Object.values(LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS)));

  return {
    messageCount: messages.length,
    customerCount: customers.length,
    messageIds: messages.map((row) => row.id).sort(),
    subjects: messages.map((row) => row.subject).sort(),
  };
}

export type LocalMailCrmVerifyApiExpectation = {
  messageKey: keyof typeof LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS;
  staffAAssociation: boolean;
  staffBAssociation: boolean;
  adminAssociation?: boolean;
  associationType?: "manual" | "auto_match";
};

export async function verifyLocalMailCrmVerificationApiSecurity(
  db: Database,
): Promise<LocalMailCrmVerifyApiExpectation[]> {
  const staffA = mailActor(SEED_IDS.staffA);
  const staffB = mailActor(SEED_IDS.staffB);
  const admin = mailActor(SEED_IDS.admin);

  const scenarios: Array<{
    messageKey: keyof typeof LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS;
    messageId: string;
    folder: "inbox" | "sent";
    staffAAssociation: boolean;
    staffBAssociation: boolean;
    adminAssociation?: boolean;
    associationType?: "manual" | "auto_match";
  }> = [
    {
      messageKey: "accessibleCustomer",
      messageId: LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.accessibleCustomer,
      folder: "inbox",
      staffAAssociation: true,
      staffBAssociation: false,
      adminAssociation: true,
      associationType: "auto_match",
    },
    {
      messageKey: "publicPoolCustomer",
      messageId: LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.publicPoolCustomer,
      folder: "inbox",
      staffAAssociation: false,
      staffBAssociation: false,
      adminAssociation: true,
      associationType: "auto_match",
    },
    {
      messageKey: "externalNoMatch",
      messageId: LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.externalNoMatch,
      folder: "inbox",
      staffAAssociation: false,
      staffBAssociation: false,
      adminAssociation: false,
    },
    {
      messageKey: "outboundManual",
      messageId: LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.outboundManual,
      folder: "sent",
      staffAAssociation: true,
      staffBAssociation: false,
      adminAssociation: true,
      associationType: "manual",
    },
  ];

  const results: LocalMailCrmVerifyApiExpectation[] = [];

  for (const scenario of scenarios) {
    const detailA = await getMessageDetail(db, staffA, scenario.messageId, {
      folder: scenario.folder,
    });
    const detailB = await getMessageDetail(db, staffB, scenario.messageId, {
      folder: scenario.folder,
    });
    const detailAdmin = await getMessageDetail(db, admin, scenario.messageId, {
      folder: scenario.folder,
    });

    const hasA = detailA.customerAssociation != null;
    const hasB = detailB.customerAssociation != null;
    const hasAdmin = detailAdmin.customerAssociation != null;

    if (hasA !== scenario.staffAAssociation) {
      throw new Error(
        `Staff A CRM association mismatch for ${scenario.messageKey}: expected ${scenario.staffAAssociation}, got ${hasA}`,
      );
    }
    if (hasB !== scenario.staffBAssociation) {
      throw new Error(
        `Staff B CRM association mismatch for ${scenario.messageKey}: expected ${scenario.staffBAssociation}, got ${hasB}`,
      );
    }
    if (
      scenario.adminAssociation !== undefined &&
      hasAdmin !== scenario.adminAssociation
    ) {
      throw new Error(
        `Admin CRM association mismatch for ${scenario.messageKey}: expected ${scenario.adminAssociation}, got ${hasAdmin}`,
      );
    }
    if (scenario.associationType && hasA) {
      if (detailA.customerAssociation?.associationType !== scenario.associationType) {
        throw new Error(
          `Staff A association type mismatch for ${scenario.messageKey}`,
        );
      }
    }

    results.push({
      messageKey: scenario.messageKey,
      staffAAssociation: hasA,
      staffBAssociation: hasB,
      adminAssociation: hasAdmin,
      associationType: detailA.customerAssociation?.associationType,
    });
  }

  return results;
}

export async function verifyLocalMailCrmCustomerAccess(db: Database) {
  const staffAUser = await getUserById(SEED_IDS.staffA);
  const staffBUser = await getUserById(SEED_IDS.staffB);
  if (!staffAUser || !staffBUser) {
    throw new Error("Seed users missing for CRM access verification");
  }

  const staffALookup = await lookupMailCustomerByEmail(
    db,
    staffAUser,
    LOCAL_MAIL_CRM_VERIFY_ADDRESSES.customerAEmail,
  );
  const staffBLookup = await lookupMailCustomerByEmail(
    db,
    staffBUser,
    LOCAL_MAIL_CRM_VERIFY_ADDRESSES.customerAEmail,
  );
  const staffAPoolLookup = await lookupMailCustomerByEmail(
    db,
    staffAUser,
    LOCAL_MAIL_CRM_VERIFY_ADDRESSES.publicPoolEmail,
  );

  if (!staffALookup.matched || !staffALookup.customer) {
    throw new Error("Staff A should match accessible fixture customer");
  }
  if (staffBLookup.matched) {
    throw new Error("Staff B must not match accessible fixture customer");
  }
  if (staffAPoolLookup.matched) {
    throw new Error("Staff A must not match Public Pool fixture customer");
  }

  const staffAResolver = await resolveMessageCustomerAssociation(
    db,
    mailActor(SEED_IDS.staffA),
    {
      id: LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.accessibleCustomer,
      direction: "inbound",
      fromAddress: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.customerAEmail,
      mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
    },
  );
  const staffBResolver = await resolveMessageCustomerAssociation(
    db,
    mailActor(SEED_IDS.staffB),
    {
      id: LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.accessibleCustomer,
      direction: "inbound",
      fromAddress: LOCAL_MAIL_CRM_VERIFY_ADDRESSES.customerAEmail,
      mailboxId: LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared,
    },
  );

  if (!staffAResolver) {
    throw new Error("Staff A resolver should return accessible association");
  }
  if (staffBResolver) {
    throw new Error("Staff B resolver must return null for accessible customer");
  }

  return {
    staffAMatchesCustomerA: true,
    staffBDeniedCustomerA: true,
    staffADeniedPublicPool: true,
  };
}

export async function countLocalMailCrmFixtureRows(db: Database) {
  const pattern = fixtureLikePattern();
  const [messages] = await db
    .select({ count: schema.mailMessages.id })
    .from(schema.mailMessages)
    .where(like(schema.mailMessages.id, pattern));
  return { messageSample: messages?.count ?? null };
}
