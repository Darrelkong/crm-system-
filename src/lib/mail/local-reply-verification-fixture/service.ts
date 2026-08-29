import { and, eq, inArray, isNull, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, releaseTestDatabase, type Database } from "@/lib/db";
import { buildReplaceCustomerIdentifierStatements } from "@/lib/customers/contact-identifiers";
import { assertFixtureAddressesDoNotCollideWithCrmContacts } from "@/lib/mail/local-verification-fixture/collision";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { createSeededComposeDraft } from "@/lib/mail/compose-draft-seed-service";
import { MailServiceError } from "@/lib/mail/errors";
import { runMailBatch } from "@/lib/mail/guarded-batch";
import {
  getMessageDetail,
  listAccessibleMessages,
} from "@/lib/mail/mail-read-service";
import {
  LOCAL_MAIL_REPLY_VERIFY_ADDRESSES,
  LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_CODES,
  LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_IDS,
  LOCAL_MAIL_REPLY_VERIFY_FIXTURE_ACTORS,
  LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX,
  LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS,
  LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS,
  LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS,
  LOCAL_MAIL_REPLY_VERIFY_SUBJECTS,
  replyFixtureTimestamp,
} from "@/lib/mail/local-reply-verification-fixture/constants";
import {
  assertLocalMailReplyVerifyFixtureAllowed,
  type LocalMailReplyVerifyCliTarget,
} from "@/lib/mail/local-reply-verification-fixture/guard";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";

function fixtureLikePattern(): string {
  return `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}%`;
}

/** Fixture message rows that lost canonical body rows (e.g. interrupted cleanup). */
export async function listFixtureMessagesMissingBodies(
  db: Database,
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.mailMessages.id })
    .from(schema.mailMessages)
    .leftJoin(
      schema.mailMessageBodies,
      eq(schema.mailMessageBodies.messageId, schema.mailMessages.id),
    )
    .where(
      and(
        like(schema.mailMessages.id, fixtureLikePattern()),
        isNull(schema.mailMessageBodies.messageId),
      ),
    );

  return rows.map((row) => row.id).sort();
}

function mailActor(userId: string): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants:
      userId === SEED_IDS.admin
        ? ["account_mgmt", "address_assignment", "signature_template"]
        : [],
    audit: {
      ipAddress: "127.0.0.1",
      userAgent: "local-mail-reply-verify-2h6e",
    },
  };
}

export async function connectLocalMailReplyVerificationFixtureDb(
  target: LocalMailReplyVerifyCliTarget,
): Promise<{ db: Database; dispose: () => Promise<void> }> {
  assertLocalMailReplyVerifyFixtureAllowed(target);
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

/**
 * Atomically deletes the message graph child rows then parent rows using D1 batch().
 * Do not use db.transaction() — local D1 rejects literal BEGIN/COMMIT/ROLLBACK.
 */
async function deleteFixtureMessageGraphBatch(
  db: Database,
  messageIds: string[],
): Promise<void> {
  if (!messageIds.length) return;

  await runMailBatch(db, [
    db
      .delete(schema.mailMessageAttachments)
      .where(inArray(schema.mailMessageAttachments.messageId, messageIds)),
    db
      .delete(schema.mailMessageRecipients)
      .where(inArray(schema.mailMessageRecipients.messageId, messageIds)),
    db
      .delete(schema.mailMessageReadStates)
      .where(inArray(schema.mailMessageReadStates.messageId, messageIds)),
    db
      .delete(schema.mailMessageBodies)
      .where(inArray(schema.mailMessageBodies.messageId, messageIds)),
    db.delete(schema.mailMessages).where(inArray(schema.mailMessages.id, messageIds)),
  ]);
}

async function deleteRevisionGraph(db: Database, revisionIds: string[]) {
  if (!revisionIds.length) return;

  const revisions = await db
    .select({
      id: schema.mailOutboundRevisions.id,
      chainId: schema.mailOutboundRevisions.revisionChainId,
      snapshotId: schema.mailOutboundRevisions.signatureSnapshotId,
    })
    .from(schema.mailOutboundRevisions)
    .where(inArray(schema.mailOutboundRevisions.id, revisionIds));

  const chainIds = [...new Set(revisions.map((row) => row.chainId))];
  const snapshotIds = [...new Set(revisions.map((row) => row.snapshotId))];

  const sendOps = await db
    .select({ id: schema.mailSendOperations.id })
    .from(schema.mailSendOperations)
    .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds));
  const sendIds = sendOps.map((row) => row.id);

  if (sendIds.length) {
    const materializations = await db
      .select({
        mailMessageId: schema.mailOutboundMessageMaterializations.mailMessageId,
      })
      .from(schema.mailOutboundMessageMaterializations)
      .where(
        inArray(schema.mailOutboundMessageMaterializations.sendOperationId, sendIds),
      );
    const materializedMessageIds = materializations
      .map((row) => row.mailMessageId)
      .filter((id): id is string => Boolean(id));

    await db
      .delete(schema.mailOutboundMessageMaterializations)
      .where(
        inArray(schema.mailOutboundMessageMaterializations.sendOperationId, sendIds),
      );

    if (materializedMessageIds.length) {
      await deleteFixtureMessageGraphBatch(db, materializedMessageIds);
    }

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

  await db
    .delete(schema.mailOutboundRevisionAttachments)
    .where(inArray(schema.mailOutboundRevisionAttachments.revisionId, revisionIds));
  await db
    .delete(schema.mailOutboundRevisionRecipients)
    .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds));
  await db
    .delete(schema.mailOutboundRevisions)
    .where(inArray(schema.mailOutboundRevisions.id, revisionIds));

  if (snapshotIds.length) {
    await db
      .delete(schema.mailSignatureSnapshotAssets)
      .where(
        inArray(schema.mailSignatureSnapshotAssets.signatureSnapshotId, snapshotIds),
      );
    await db
      .delete(schema.mailSignatureSnapshots)
      .where(inArray(schema.mailSignatureSnapshots.id, snapshotIds));
  }
}

async function deleteDraftGraph(db: Database, draftIds: string[]) {
  if (!draftIds.length) return;

  const revisions = await db
    .select({ id: schema.mailOutboundRevisions.id })
    .from(schema.mailOutboundRevisions)
    .where(inArray(schema.mailOutboundRevisions.sourceDraftId, draftIds));
  await deleteRevisionGraph(
    db,
    revisions.map((row) => row.id),
  );

  await db
    .delete(schema.mailDraftAttachments)
    .where(inArray(schema.mailDraftAttachments.draftId, draftIds));
  await db
    .delete(schema.mailDraftRecipients)
    .where(inArray(schema.mailDraftRecipients.draftId, draftIds));
  await db.delete(schema.mailDrafts).where(inArray(schema.mailDrafts.id, draftIds));
}

async function deleteFixtureMessagesByIds(db: Database, messageIds: string[]) {
  if (!messageIds.length) return;

  await db
    .delete(schema.mailOutboundMessageMaterializations)
    .where(inArray(schema.mailOutboundMessageMaterializations.mailMessageId, messageIds));

  const referencingDrafts = await db
    .select({ id: schema.mailDrafts.id })
    .from(schema.mailDrafts)
    .where(inArray(schema.mailDrafts.replyToMessageId, messageIds));
  await deleteDraftGraph(
    db,
    referencingDrafts.map((row) => row.id),
  );

  const referencingRevisions = await db
    .select({ id: schema.mailOutboundRevisions.id })
    .from(schema.mailOutboundRevisions)
    .where(inArray(schema.mailOutboundRevisions.replyToMessageId, messageIds));
  await deleteRevisionGraph(
    db,
    referencingRevisions.map((row) => row.id),
  );

  await deleteFixtureMessageGraphBatch(db, messageIds);
}

export async function cleanupLocalMailReplyVerificationFixtures(
  db: Database,
): Promise<{
  deletedMessageCount: number;
  deletedCustomerCount: number;
  deletedMailboxCount: number;
  deletedDraftCount: number;
}> {
  const pattern = fixtureLikePattern();
  const customerIds = Object.values(LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_IDS);

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

  const identities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(
      or(
        like(schema.mailSenderIdentities.id, pattern),
        like(schema.mailSenderIdentities.address, "local-mail-reply-verify-2h6e-%"),
      )!,
    );
  const identityIds = identities.map((row) => row.id);

  const draftIdSets = await Promise.all([
    mailboxIds.length
      ? db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.mailboxId, mailboxIds))
      : Promise.resolve([]),
    identityIds.length
      ? db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.senderIdentityId, identityIds))
      : Promise.resolve([]),
    messageIds.length
      ? db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.replyToMessageId, messageIds))
      : Promise.resolve([]),
    db
      .select({ id: schema.mailDrafts.id })
      .from(schema.mailDrafts)
      .where(like(schema.mailDrafts.id, pattern)),
  ]);
  const draftIds = [
    ...new Set(draftIdSets.flatMap((rows) => rows.map((row) => row.id))),
  ];
  await deleteDraftGraph(db, draftIds);

  if (identityIds.length) {
    const revisionsByIdentity = await db
      .select({ id: schema.mailOutboundRevisions.id })
      .from(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.senderIdentityId, identityIds));
    await deleteRevisionGraph(
      db,
      revisionsByIdentity.map((row) => row.id),
    );
  }

  await deleteFixtureMessagesByIds(db, messageIds);

  const threadIds = [
    ...messageIds.map((id) => `${id}-THREAD`),
    ...(mailboxIds.length
      ? (
          await db
            .select({ id: schema.mailThreads.id })
            .from(schema.mailThreads)
            .where(inArray(schema.mailThreads.mailboxId, mailboxIds))
        ).map((row) => row.id)
      : []),
  ];
  if (threadIds.length) {
    await db
      .delete(schema.mailThreads)
      .where(inArray(schema.mailThreads.id, [...new Set(threadIds)]));
  }

  if (identityIds.length) {
    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds));
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
        like(schema.mailSenderIdentities.address, "local-mail-reply-verify-2h6e-%"),
      )!,
    );

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

  if (customerIds.length) {
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
    deletedDraftCount: draftIds.length,
  };
}

async function upsertFixtureCustomers(db: Database, now: string) {
  await db.insert(schema.customers).values([
    {
      id: LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_IDS.visible,
      customerCode: LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_CODES.visible,
      customerName: "LOCAL REPLY VERIFY CRM Visible",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+852",
      phone: null,
      wechatId: null,
      email: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.crmVisibleEmail,
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
      id: LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_IDS.hiddenPool,
      customerCode: LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_CODES.hiddenPool,
      customerName: "LOCAL REPLY VERIFY CRM Hidden",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+852",
      phone: null,
      wechatId: null,
      email: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.crmHiddenEmail,
      source: "local_fixture",
      salesStage: "new_lead",
      ownerId: null,
      status: "public_pool",
      releaserUserId: SEED_IDS.staffA,
      releasedBy: SEED_IDS.staffA,
      poolEnteredAt: now,
      poolReason: "LOCAL_MAIL_REPLY_VERIFY_2H6E fixture",
      createdBy: SEED_IDS.admin,
      updatedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  for (const customerId of Object.values(LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_IDS)) {
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

async function insertMailboxMember(
  db: Database,
  input: {
    id: string;
    mailboxId: string;
    userId: string;
    canReply?: boolean;
    canSend?: boolean;
  },
  now: string,
) {
  await db.insert(schema.mailMailboxMembers).values({
    id: input.id,
    mailboxId: input.mailboxId,
    userId: input.userId,
    canRead: 1,
    canReply: input.canReply ? 1 : 0,
    canSend: input.canSend ? 1 : 0,
    canAssign: 0,
    canManageProcessing: 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

type RecipientInput = {
  id: string;
  recipientType: "to" | "cc" | "bcc";
  address: string;
  sortOrder: number;
};

async function insertMessage(
  db: Database,
  input: {
    id: string;
    mailboxId: string;
    direction: "inbound" | "outbound";
    subject: string;
    fromAddress: string;
    fromDisplayName?: string;
    bodyText: string;
    bodyHtmlSanitized?: string | null;
    receivedAt?: string | null;
    sentAt?: string | null;
    trashedAt?: string | null;
    senderIdentityId?: string | null;
    recipients: RecipientInput[];
  },
  now: string,
) {
  const threadId = `${input.id}-THREAD`;
  const timestamp = input.receivedAt ?? input.sentAt ?? now;

  await db.insert(schema.mailThreads).values({
    id: threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: input.subject.toLowerCase(),
    lastMessageAt: timestamp,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: input.direction,
    senderIdentityId: input.senderIdentityId ?? null,
    fromAddress: input.fromAddress,
    fromDisplayName: input.fromDisplayName ?? "Fixture Sender",
    subject: input.subject,
    subjectNormalized: input.subject.toLowerCase(),
    previewText: input.bodyText.slice(0, 120),
    receivedAt: input.direction === "inbound" ? timestamp : null,
    sentAt: input.direction === "outbound" ? timestamp : null,
    trashedAt: input.trashedAt ?? null,
    composeMode: input.direction === "outbound" ? "new" : null,
    createdBy: input.direction === "outbound" ? SEED_IDS.staffA : null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: input.bodyText,
    bodyHtmlSanitized:
      input.bodyHtmlSanitized ??
      `<p>${input.bodyText.replace(/</g, "&lt;")}</p>`,
    quotedText: null,
    quotedHtmlSanitized: null,
    createdAt: now,
    updatedAt: now,
  });

  for (const recipient of input.recipients) {
    await db.insert(schema.mailMessageRecipients).values({
      id: recipient.id,
      messageId: input.id,
      recipientType: recipient.recipientType,
      address: recipient.address,
      displayName: null,
      sortOrder: recipient.sortOrder,
      createdAt: now,
    });
  }
}

export async function setupLocalMailReplyVerificationFixtures(db: Database) {
  await cleanupLocalMailReplyVerificationFixtures(db);

  await assertFixtureAddressesDoNotCollideWithCrmContacts(db, [
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.staffAMailbox,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.staffASender,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.staffBSender,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.sharedMailbox,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.sharedSender,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.externalSender,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.colleague,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.ccRecipient,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.bccRecipient,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.clientRecipient,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.crmVisibleEmail,
    LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.crmHiddenEmail,
  ]);

  const now = replyFixtureTimestamp(0);

  for (const userId of Object.values(LOCAL_MAIL_REPLY_VERIFY_FIXTURE_ACTORS)) {
    await enableMailAccess(db, userId, now);
  }

  await upsertFixtureCustomers(db, now);

  await db.insert(schema.mailMailboxes).values([
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.staffAMailbox,
      displayName: "LOCAL REPLY VERIFY Staff A",
      mailboxType: "personal",
      status: "active",
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.shared,
      address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.sharedMailbox,
      displayName: "LOCAL REPLY VERIFY Shared",
      mailboxType: "shared",
      status: "active",
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(schema.mailReceivingAddresses).values([
    {
      id: `${LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA}-PRIMARY`,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.staffAMailbox,
      addressType: "primary",
      status: "active",
      createdByUserId: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.shared}-PRIMARY`,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.shared,
      address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.sharedMailbox,
      addressType: "primary",
      status: "active",
      createdByUserId: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(schema.mailSenderIdentities).values([
    {
      id: LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS.staffA,
      address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.staffASender,
      displayName: "Staff A Reply Verify",
      defaultMailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS.staffB,
      address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.staffBSender,
      displayName: "Staff B Reply Verify",
      defaultMailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.shared,
      status: "active",
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS.shared,
      address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.sharedSender,
      displayName: "Shared Mailbox Sender",
      defaultMailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.shared,
      status: "active",
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await grantSenderIdentityAccess(db, mailActor(SEED_IDS.admin), {
    senderIdentityId: LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS.staffA,
    targetUserId: SEED_IDS.staffA,
    canSend: true,
  });
  await grantSenderIdentityAccess(db, mailActor(SEED_IDS.admin), {
    senderIdentityId: LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS.staffB,
    targetUserId: SEED_IDS.staffB,
    canSend: true,
  });

  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MEMBER-STAFF-A`,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      userId: SEED_IDS.staffA,
      canReply: true,
      canSend: true,
    },
    now,
  );
  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MEMBER-SHARED-A`,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.shared,
      userId: SEED_IDS.staffA,
      canReply: true,
      canSend: true,
    },
    now,
  );
  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MEMBER-SHARED-B`,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.shared,
      userId: SEED_IDS.staffB,
      canReply: true,
      canSend: true,
    },
    now,
  );

  const staffAToRecipient = (messageId: string) => ({
    id: `${messageId}-TO`,
    recipientType: "to" as const,
    address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.staffAMailbox,
    sortOrder: 0,
  });

  await insertMessage(
    db,
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReply,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      direction: "inbound",
      subject: LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.inboundReply,
      fromAddress: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.externalSender,
      bodyText: "Inbound reply fixture body with safe HTML.",
      bodyHtmlSanitized:
        "<p>Inbound reply fixture body with <strong>safe HTML</strong>.</p>",
      receivedAt: replyFixtureTimestamp(10),
      recipients: [staffAToRecipient(LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReply)],
    },
    now,
  );

  await insertMessage(
    db,
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReplyAll,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      direction: "inbound",
      subject: LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.inboundReplyAll,
      fromAddress: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.externalSender,
      bodyText: "Reply All fixture body.",
      receivedAt: replyFixtureTimestamp(9),
      recipients: [
        staffAToRecipient(LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReplyAll),
        {
          id: `${LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReplyAll}-TO-2`,
          recipientType: "to",
          address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.colleague,
          sortOrder: 1,
        },
        {
          id: `${LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReplyAll}-CC`,
          recipientType: "cc",
          address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.ccRecipient,
          sortOrder: 2,
        },
        {
          id: `${LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReplyAll}-BCC`,
          recipientType: "bcc",
          address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.bccRecipient,
          sortOrder: 3,
        },
      ],
    },
    now,
  );

  await insertMessage(
    db,
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.sentReply,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      direction: "outbound",
      subject: LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.sentReply,
      fromAddress: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.staffASender,
      senderIdentityId: LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS.staffA,
      bodyText: "Sent reply fixture body.",
      sentAt: replyFixtureTimestamp(8),
      recipients: [
        {
          id: `${LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.sentReply}-TO`,
          recipientType: "to",
          address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.clientRecipient,
          sortOrder: 0,
        },
      ],
    },
    now,
  );

  await insertMessage(
    db,
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.forward,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      direction: "inbound",
      subject: LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.forward,
      fromAddress: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.externalSender,
      bodyText: "Forward fixture body.",
      receivedAt: replyFixtureTimestamp(7),
      recipients: [
        staffAToRecipient(LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.forward),
        {
          id: `${LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.forward}-CC`,
          recipientType: "cc",
          address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.ccRecipient,
          sortOrder: 1,
        },
        {
          id: `${LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.forward}-BCC`,
          recipientType: "bcc",
          address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.bccRecipient,
          sortOrder: 2,
        },
      ],
    },
    now,
  );

  await insertMessage(
    db,
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.sharedReply,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.shared,
      direction: "inbound",
      subject: LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.sharedReply,
      fromAddress: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.externalSender,
      bodyText: "Shared mailbox reply fixture body.",
      receivedAt: replyFixtureTimestamp(6),
      recipients: [
        {
          id: `${LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.sharedReply}-TO`,
          recipientType: "to",
          address: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.sharedMailbox,
          sortOrder: 0,
        },
      ],
    },
    now,
  );

  await insertMessage(
    db,
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.crmVisible,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      direction: "inbound",
      subject: LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.crmVisible,
      fromAddress: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.crmVisibleEmail,
      bodyText: "CRM visible fixture body.",
      receivedAt: replyFixtureTimestamp(5),
      recipients: [staffAToRecipient(LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.crmVisible)],
    },
    now,
  );

  await insertMessage(
    db,
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.crmHidden,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      direction: "inbound",
      subject: LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.crmHidden,
      fromAddress: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.crmHiddenEmail,
      bodyText: "CRM hidden fixture body.",
      receivedAt: replyFixtureTimestamp(4),
      recipients: [staffAToRecipient(LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.crmHidden)],
    },
    now,
  );

  await insertMessage(
    db,
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.trashReply,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      direction: "inbound",
      subject: LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.trashReply,
      fromAddress: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.externalSender,
      bodyText: "Trash reply fixture body.",
      receivedAt: replyFixtureTimestamp(3),
      trashedAt: replyFixtureTimestamp(2),
      recipients: [staffAToRecipient(LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.trashReply)],
    },
    now,
  );

  await insertMessage(
    db,
    {
      id: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.staffAOnly,
      mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
      direction: "inbound",
      subject: LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.staffAOnly,
      fromAddress: LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.externalSender,
      bodyText: "Staff A only fixture body.",
      receivedAt: replyFixtureTimestamp(1),
      recipients: [staffAToRecipient(LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.staffAOnly)],
    },
    now,
  );

  return {
    mailboxIds: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS,
    messageIds: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS,
    customerIds: LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_IDS,
  };
}

export async function verifyLocalMailReplyVerificationFixtures(db: Database) {
  const messages = await db
    .select({ id: schema.mailMessages.id, subject: schema.mailMessages.subject })
    .from(schema.mailMessages)
    .where(like(schema.mailMessages.id, fixtureLikePattern()));

  const customers = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(inArray(schema.customers.id, Object.values(LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_IDS)));

  const messagesMissingBodies = await listFixtureMessagesMissingBodies(db);

  if (messages.length === 0) {
    return {
      messageCount: 0,
      customerCount: customers.length,
      messageIds: [],
      subjects: [],
      messagesMissingBodies: [],
      fixtureBodiesComplete: true,
      listDetailIdsMatch: true,
      staffACanReadInboundReply: false,
      staffBCanReadSharedReply: false,
      staffBCannotReadStaffAOnly: true,
    };
  }

  if (messagesMissingBodies.length > 0) {
    return {
      messageCount: messages.length,
      customerCount: customers.length,
      messageIds: messages.map((row) => row.id).sort(),
      subjects: messages.map((row) => row.subject).sort(),
      messagesMissingBodies,
      fixtureBodiesComplete: false,
      listDetailIdsMatch: false,
      staffACanReadInboundReply: false,
      staffBCanReadSharedReply: false,
      staffBCannotReadStaffAOnly: true,
    };
  }

  const staffAReadable = await getMessageDetail(
    db,
    mailActor(SEED_IDS.staffA),
    LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReply,
    { folder: "inbox" },
  );
  const staffBSharedReadable = await getMessageDetail(
    db,
    mailActor(SEED_IDS.staffB),
    LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.sharedReply,
    { folder: "inbox" },
  );

  let staffBUnauthorized = false;
  try {
    await getMessageDetail(
      db,
      mailActor(SEED_IDS.staffB),
      LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.staffAOnly,
      { folder: "inbox" },
    );
  } catch (error) {
    staffBUnauthorized =
      error instanceof MailServiceError && error.status === 404;
  }

  const inboxPage = await listAccessibleMessages(db, mailActor(SEED_IDS.staffA), {
    mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
    folder: "inbox",
  });
  let listDetailIdsMatch = true;
  for (const item of inboxPage.items) {
    const detail = await getMessageDetail(db, mailActor(SEED_IDS.staffA), item.id, {
      folder: "inbox",
    });
    if (detail.id !== item.id || detail.bodyText.length === 0) {
      listDetailIdsMatch = false;
      break;
    }
  }

  return {
    messageCount: messages.length,
    customerCount: customers.length,
    messageIds: messages.map((row) => row.id).sort(),
    subjects: messages.map((row) => row.subject).sort(),
    messagesMissingBodies: [],
    fixtureBodiesComplete: true,
    listDetailIdsMatch,
    staffACanReadInboundReply:
      staffAReadable.id === LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReply,
    staffBCanReadSharedReply:
      staffBSharedReadable.id === LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.sharedReply,
    staffBCannotReadStaffAOnly: staffBUnauthorized,
  };
}

export type LocalMailReplySeedApiResult = {
  scenario: string;
  ok: boolean;
  detail?: Record<string, unknown>;
  error?: string;
};

async function cleanupVerifyDrafts(db: Database, draftIds: string[]) {
  if (!draftIds.length) return;
  await deleteDraftGraph(db, draftIds);
}

export async function verifyLocalMailReplyComposeSeedApi(
  db: Database,
): Promise<LocalMailReplySeedApiResult[]> {
  const staffA = mailActor(SEED_IDS.staffA);
  const staffB = mailActor(SEED_IDS.staffB);
  const createdDraftIds: string[] = [];
  const results: LocalMailReplySeedApiResult[] = [];

  try {
    const reply = await createSeededComposeDraft(db, staffA, {
      sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReply,
      mode: "reply",
      folder: "inbox",
    });
    createdDraftIds.push(reply.id);
    results.push({
      scenario: "R1 inbound reply",
      ok:
        reply.composeMode === "reply" &&
        reply.subject === `Re: ${LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.inboundReply}` &&
        reply.recipients[0]?.address === LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.externalSender &&
        reply.senderIdentityId === LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS.staffA,
      detail: {
        composeMode: reply.composeMode,
        subject: reply.subject,
        to: reply.recipients.map((r) => r.address),
        senderIdentityId: reply.senderIdentityId,
        attachmentCount: reply.attachments.length,
      },
    });

    const replyAll = await createSeededComposeDraft(db, staffA, {
      sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReplyAll,
      mode: "reply_all",
      folder: "inbox",
    });
    createdDraftIds.push(replyAll.id);
    const replyAllAddresses = replyAll.recipients.map((r) => r.address);
    results.push({
      scenario: "R2 reply all",
      ok:
        replyAll.composeMode === "reply_all" &&
        !replyAll.recipients.some((r) => r.recipientType === "bcc") &&
        replyAllAddresses.includes(LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.externalSender) &&
        replyAllAddresses.includes(LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.colleague) &&
        replyAllAddresses.includes(LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.ccRecipient) &&
        !replyAllAddresses.includes(LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.bccRecipient),
      detail: {
        recipients: replyAll.recipients.map((r) => ({
          type: r.recipientType,
          address: r.address,
        })),
      },
    });

    const sentReply = await createSeededComposeDraft(db, staffA, {
      sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.sentReply,
      mode: "reply",
      folder: "sent",
    });
    createdDraftIds.push(sentReply.id);
    results.push({
      scenario: "R3 sent reply",
      ok:
        sentReply.recipients.length === 1 &&
        sentReply.recipients[0]?.address === LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.clientRecipient &&
        !sentReply.recipients.some(
          (r) => r.address === LOCAL_MAIL_REPLY_VERIFY_ADDRESSES.staffASender,
        ),
      detail: {
        recipients: sentReply.recipients.map((r) => r.address),
      },
    });

    const forward = await createSeededComposeDraft(db, staffA, {
      sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.forward,
      mode: "forward",
      folder: "inbox",
    });
    createdDraftIds.push(forward.id);
    results.push({
      scenario: "R4 forward",
      ok:
        forward.composeMode === "forward" &&
        forward.recipients.length === 0 &&
        forward.subject === `Fwd: ${LOCAL_MAIL_REPLY_VERIFY_SUBJECTS.forward}` &&
        forward.attachments.length === 0 &&
        forward.bodyText.includes("Forwarded message"),
      detail: {
        subject: forward.subject,
        recipientCount: forward.recipients.length,
        attachmentCount: forward.attachments.length,
      },
    });

    const sharedReply = await createSeededComposeDraft(db, staffA, {
      sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.sharedReply,
      mode: "reply",
      folder: "inbox",
    });
    createdDraftIds.push(sharedReply.id);
    results.push({
      scenario: "R5 shared reply staff A",
      ok:
        sharedReply.composeMode === "reply" &&
        sharedReply.senderIdentityId !== LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS.shared,
      detail: {
        senderIdentityId: sharedReply.senderIdentityId,
      },
    });

    const crmVisible = await createSeededComposeDraft(db, staffA, {
      sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.crmVisible,
      mode: "reply",
      folder: "inbox",
    });
    createdDraftIds.push(crmVisible.id);
    results.push({
      scenario: "R6 CRM visible",
      ok: Boolean(crmVisible.customerAssociation?.customerId),
      detail: {
        customerId: crmVisible.customerAssociation?.customerId ?? null,
      },
    });

    const crmHidden = await createSeededComposeDraft(db, staffA, {
      sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.crmHidden,
      mode: "reply",
      folder: "inbox",
    });
    createdDraftIds.push(crmHidden.id);
    results.push({
      scenario: "R7 CRM hidden",
      ok: !crmHidden.customerAssociation,
      detail: {
        customerAssociation: crmHidden.customerAssociation ?? null,
      },
    });

    const trashReply = await createSeededComposeDraft(db, staffA, {
      sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.trashReply,
      mode: "reply",
      folder: "trash",
    });
    createdDraftIds.push(trashReply.id);
    results.push({
      scenario: "R8 trash correct folder",
      ok: trashReply.composeMode === "reply",
    });

    let trashWrongFolder = false;
    try {
      await createSeededComposeDraft(db, staffA, {
        sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.trashReply,
        mode: "reply",
        folder: "inbox",
      });
    } catch (error) {
      trashWrongFolder =
        error instanceof MailServiceError && error.status === 404;
    }
    results.push({
      scenario: "R8 trash wrong folder",
      ok: trashWrongFolder,
    });

    let staffBUnauthorized = false;
    try {
      await createSeededComposeDraft(db, staffB, {
        sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.staffAOnly,
        mode: "reply",
        folder: "inbox",
      });
    } catch (error) {
      staffBUnauthorized =
        error instanceof MailServiceError && error.status === 404;
    }
    results.push({
      scenario: "R9 staff B unauthorized",
      ok: staffBUnauthorized,
    });

    const sharedStaffB = await createSeededComposeDraft(db, staffB, {
      sourceMessageId: LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.sharedReply,
      mode: "reply",
      folder: "inbox",
    });
    createdDraftIds.push(sharedStaffB.id);
    results.push({
      scenario: "R5 shared reply staff B",
      ok:
        sharedStaffB.composeMode === "reply" &&
        sharedStaffB.senderIdentityId === LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS.staffB,
      detail: {
        senderIdentityId: sharedStaffB.senderIdentityId,
      },
    });
  } finally {
    await cleanupVerifyDrafts(db, createdDraftIds);
  }

  return results;
}
