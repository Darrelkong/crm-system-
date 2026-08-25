import { and, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, releaseTestDatabase, type Database } from "@/lib/db";
import { assertFixtureAddressesDoNotCollideWithCrmContacts } from "@/lib/mail/local-verification-fixture/collision";
import {
  fixtureSubject,
  fixtureTimestamp,
  LOCAL_MAIL_VERIFY_ADDRESSES,
  LOCAL_MAIL_VERIFY_FIXTURE_ACTORS,
  LOCAL_MAIL_VERIFY_FIXTURE_PREFIX,
  LOCAL_MAIL_VERIFY_MAILBOX_IDS,
  LOCAL_MAIL_VERIFY_MESSAGE_IDS,
  LOCAL_MAIL_VERIFY_SENDER_IDENTITY_ID,
} from "@/lib/mail/local-verification-fixture/constants";
import {
  assertLocalMailVerifyFixtureAllowed,
  type LocalMailVerifyCliTarget,
} from "@/lib/mail/local-verification-fixture/guard";

export type LocalMailVerifyFixtureMetadata = {
  fixtureKey: keyof typeof LOCAL_MAIL_VERIFY_MESSAGE_IDS;
  messageId: string;
  mailboxCategory: "staff_personal" | "shared";
  direction: "inbound" | "outbound";
  projectedFolder: "inbox" | "sent" | "trash";
  hasHtml: boolean;
  hasQuoted: boolean;
  hasAttachmentMetadata: boolean;
  initialUnreadForStaffA: boolean;
};

export type LocalMailVerifySetupResult = {
  mailboxIds: typeof LOCAL_MAIL_VERIFY_MAILBOX_IDS;
  messageIds: typeof LOCAL_MAIL_VERIFY_MESSAGE_IDS;
  metadata: LocalMailVerifyFixtureMetadata[];
};

function fixtureLikePattern(): string {
  return `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}%`;
}

export async function connectLocalVerificationFixtureDb(
  target: LocalMailVerifyCliTarget,
): Promise<{ db: Database; dispose: () => Promise<void> }> {
  assertLocalMailVerifyFixtureAllowed(target);
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

export async function cleanupLocalMailVerificationFixtures(
  db: Database,
): Promise<{ deletedMessageCount: number; deletedMailboxCount: number }> {
  const pattern = fixtureLikePattern();

  const fixtureMailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.id, pattern));
  const fixtureMailboxIds = fixtureMailboxes.map((row) => row.id);

  const fixtureMessagesById = await db
    .select({ id: schema.mailMessages.id })
    .from(schema.mailMessages)
    .where(like(schema.mailMessages.id, pattern));
  const fixtureMessagesByMailbox =
    fixtureMailboxIds.length > 0
      ? await db
          .select({ id: schema.mailMessages.id })
          .from(schema.mailMessages)
          .where(inArray(schema.mailMessages.mailboxId, fixtureMailboxIds))
      : [];
  const messageIds = [
    ...new Set([
      ...fixtureMessagesById.map((row) => row.id),
      ...fixtureMessagesByMailbox.map((row) => row.id),
    ]),
  ];

  if (messageIds.length > 0) {
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

  const threadIds = [
    ...new Set([
      ...Object.values(LOCAL_MAIL_VERIFY_MESSAGE_IDS).map((id) => `${id}-THREAD`),
      ...(fixtureMailboxIds.length
        ? (
            await db
              .select({ id: schema.mailThreads.id })
              .from(schema.mailThreads)
              .where(inArray(schema.mailThreads.mailboxId, fixtureMailboxIds))
          ).map((row) => row.id)
        : []),
    ]),
  ];
  if (threadIds.length > 0) {
    await db
      .delete(schema.mailThreads)
      .where(inArray(schema.mailThreads.id, threadIds));
  }

  await db
    .delete(schema.mailStoredFiles)
    .where(like(schema.mailStoredFiles.id, pattern));

  await db
    .delete(schema.mailSenderIdentities)
    .where(
      or(
        like(schema.mailSenderIdentities.id, pattern),
        like(schema.mailSenderIdentities.address, "local-mail-verify-2h3d5b-%"),
      )!,
    );

  if (fixtureMailboxIds.length > 0) {
    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, fixtureMailboxIds));
    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, fixtureMailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, fixtureMailboxIds));
  }

  return {
    deletedMessageCount: messageIds.length,
    deletedMailboxCount: fixtureMailboxIds.length,
  };
}

async function insertMailboxMember(
  db: Database,
  input: {
    id: string;
    mailboxId: string;
    userId: string;
    canRead?: boolean;
    canSend?: boolean;
  },
  now: string,
) {
  await db.insert(schema.mailMailboxMembers).values({
    id: input.id,
    mailboxId: input.mailboxId,
    userId: input.userId,
    canRead: input.canRead === false ? 0 : 1,
    canReply: 0,
    canSend: input.canSend ? 1 : 0,
    canAssign: 0,
    canManageProcessing: 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertFixtureMessage(
  db: Database,
  input: {
    id: string;
    mailboxId: string;
    direction: "inbound" | "outbound";
    subject: string;
    bodyText: string;
    bodyHtmlSanitized?: string | null;
    quotedText?: string | null;
    quotedHtmlSanitized?: string | null;
    receivedAt?: string | null;
    sentAt?: string | null;
    trashedAt?: string | null;
    createdBy?: string | null;
    senderIdentityId?: string | null;
    withAttachment?: boolean;
    recipients?: Array<{
      id: string;
      recipientType: "to" | "cc" | "bcc";
      address: string;
      sortOrder: number;
    }>;
    fromAddress?: string;
    fromDisplayName?: string | null;
  },
  now: string,
) {
  const threadId = `${input.id}-THREAD`;
  await db.insert(schema.mailThreads).values({
    id: threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: input.subject.toLowerCase(),
    lastMessageAt: input.receivedAt ?? input.sentAt ?? now,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: input.direction,
    senderIdentityId:
      input.direction === "outbound" ? (input.senderIdentityId ?? null) : null,
    fromAddress:
      input.fromAddress ??
      (input.direction === "inbound"
        ? LOCAL_MAIL_VERIFY_ADDRESSES.inboundSender
        : LOCAL_MAIL_VERIFY_ADDRESSES.senderIdentity),
    fromDisplayName:
      input.fromDisplayName ??
      (input.direction === "inbound" ? "Local Verify Sender" : "Local Verify Outbound"),
    subject: input.subject,
    subjectNormalized: input.subject.toLowerCase(),
    previewText: input.bodyText.slice(0, 120),
    receivedAt:
      input.direction === "inbound" ? (input.receivedAt ?? now) : null,
    sentAt:
      input.direction === "outbound" ? (input.sentAt ?? now) : input.sentAt ?? null,
    trashedAt: input.trashedAt ?? null,
    composeMode: input.direction === "outbound" ? "new" : null,
    createdBy: input.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: input.bodyText,
    bodyHtmlSanitized: input.bodyHtmlSanitized ?? null,
    quotedText: input.quotedText ?? null,
    quotedHtmlSanitized: input.quotedHtmlSanitized ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const recipients =
    input.recipients ??
    [
      {
        id: `${input.id}-TO`,
        recipientType: "to" as const,
        address: LOCAL_MAIL_VERIFY_ADDRESSES.toRecipient,
        sortOrder: 0,
      },
    ];

  for (const recipient of recipients) {
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

  if (input.withAttachment) {
    const storedFileId = `${input.id}-FILE`;
    await db.insert(schema.mailStoredFiles).values({
      id: storedFileId,
      contentHash: "b".repeat(64),
      originalFilename: "local-verify-fixture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      storageProvider: "r2",
      storageBucket: "crm-attachments-preview",
      storageKey: `local-mail-verify/${storedFileId}`,
      createdAt: now,
    });
    await db.insert(schema.mailMessageAttachments).values({
      id: `${input.id}-ATTACHMENT`,
      messageId: input.id,
      storedFileId,
      contentHash: "b".repeat(64),
      originalFilename: "local-verify-fixture.pdf",
      displayFilename: "local-verify-fixture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      sortOrder: 0,
      deliveryMode: "direct_attachment",
      createdAt: now,
    });
  }
}

export async function setupLocalMailVerificationFixtures(
  db: Database,
): Promise<LocalMailVerifySetupResult> {
  await cleanupLocalMailVerificationFixtures(db);

  await assertFixtureAddressesDoNotCollideWithCrmContacts(db, [
    LOCAL_MAIL_VERIFY_ADDRESSES.inboundSender,
    LOCAL_MAIL_VERIFY_ADDRESSES.toRecipient,
    LOCAL_MAIL_VERIFY_ADDRESSES.ccRecipient,
    LOCAL_MAIL_VERIFY_ADDRESSES.bccRecipient,
    LOCAL_MAIL_VERIFY_ADDRESSES.staffPersonalMailbox,
    LOCAL_MAIL_VERIFY_ADDRESSES.sharedMailbox,
    LOCAL_MAIL_VERIFY_ADDRESSES.senderIdentity,
  ]);

  const now = fixtureTimestamp(0);

  await db.insert(schema.mailMailboxes).values([
    {
      id: LOCAL_MAIL_VERIFY_MAILBOX_IDS.staffPersonal,
      address: LOCAL_MAIL_VERIFY_ADDRESSES.staffPersonalMailbox,
      displayName: "Local Verify Staff Personal",
      mailboxType: "personal",
      status: "active",
      createdBy: LOCAL_MAIL_VERIFY_FIXTURE_ACTORS.staffA,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: LOCAL_MAIL_VERIFY_MAILBOX_IDS.shared,
      address: LOCAL_MAIL_VERIFY_ADDRESSES.sharedMailbox,
      displayName: "Local Verify Shared",
      mailboxType: "shared",
      status: "active",
      createdBy: LOCAL_MAIL_VERIFY_FIXTURE_ACTORS.admin,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MEM-STAFF-PERSONAL`,
      mailboxId: LOCAL_MAIL_VERIFY_MAILBOX_IDS.staffPersonal,
      userId: LOCAL_MAIL_VERIFY_FIXTURE_ACTORS.staffA,
    },
    now,
  );
  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MEM-SHARED-STAFF-A`,
      mailboxId: LOCAL_MAIL_VERIFY_MAILBOX_IDS.shared,
      userId: LOCAL_MAIL_VERIFY_FIXTURE_ACTORS.staffA,
    },
    now,
  );
  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MEM-SHARED-STAFF-B`,
      mailboxId: LOCAL_MAIL_VERIFY_MAILBOX_IDS.shared,
      userId: LOCAL_MAIL_VERIFY_FIXTURE_ACTORS.staffB,
    },
    now,
  );
  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MEM-SHARED-ADMIN`,
      mailboxId: LOCAL_MAIL_VERIFY_MAILBOX_IDS.shared,
      userId: LOCAL_MAIL_VERIFY_FIXTURE_ACTORS.admin,
    },
    now,
  );

  await db.insert(schema.mailSenderIdentities).values({
    id: LOCAL_MAIL_VERIFY_SENDER_IDENTITY_ID,
    address: LOCAL_MAIL_VERIFY_ADDRESSES.senderIdentity,
    displayName: "Local Verify Sender Identity",
    status: "active",
    defaultMailboxId: LOCAL_MAIL_VERIFY_MAILBOX_IDS.staffPersonal,
    sentFolderMailboxId: LOCAL_MAIL_VERIFY_MAILBOX_IDS.staffPersonal,
    aliasOfIdentityId: null,
    createdBy: LOCAL_MAIL_VERIFY_FIXTURE_ACTORS.admin,
    createdAt: now,
    updatedAt: now,
  });

  const staffPersonal = LOCAL_MAIL_VERIFY_MAILBOX_IDS.staffPersonal;
  const shared = LOCAL_MAIL_VERIFY_MAILBOX_IDS.shared;

  await insertFixtureMessage(
    db,
    {
      id: LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxBasic,
      mailboxId: staffPersonal,
      direction: "inbound",
      subject: fixtureSubject("Inbox Basic"),
      bodyText: "Local verification plain-text inbox body.",
      receivedAt: fixtureTimestamp(0),
    },
    now,
  );

  await insertFixtureMessage(
    db,
    {
      id: LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxHtml,
      mailboxId: staffPersonal,
      direction: "inbound",
      subject: fixtureSubject("HTML Body"),
      bodyText: "Local verification HTML inbox body.",
      bodyHtmlSanitized:
        "<p><strong>Local verify</strong> sanitized HTML with a <a href=\"https://example.test/local-verify\">safe link</a>.</p><ul><li>Item one</li></ul>",
      receivedAt: fixtureTimestamp(1),
    },
    now,
  );

  await insertFixtureMessage(
    db,
    {
      id: LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxQuoted,
      mailboxId: staffPersonal,
      direction: "inbound",
      subject: fixtureSubject("Quoted Message"),
      bodyText: "Reply body for quoted-content verification.",
      quotedText: "> Original local verification quoted plain text.",
      quotedHtmlSanitized:
        "<blockquote><p>Original local verification quoted HTML.</p></blockquote>",
      receivedAt: fixtureTimestamp(2),
    },
    now,
  );

  await insertFixtureMessage(
    db,
    {
      id: LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxAttachment,
      mailboxId: staffPersonal,
      direction: "inbound",
      subject: fixtureSubject("Attachment Metadata"),
      bodyText: "Local verification attachment metadata body.",
      receivedAt: fixtureTimestamp(3),
      withAttachment: true,
    },
    now,
  );

  await insertFixtureMessage(
    db,
    {
      id: LOCAL_MAIL_VERIFY_MESSAGE_IDS.sent,
      mailboxId: staffPersonal,
      direction: "outbound",
      subject: fixtureSubject("Sent Message"),
      bodyText: "Local verification sent folder body.",
      sentAt: fixtureTimestamp(10),
      createdBy: LOCAL_MAIL_VERIFY_FIXTURE_ACTORS.staffA,
      senderIdentityId: LOCAL_MAIL_VERIFY_SENDER_IDENTITY_ID,
    },
    now,
  );

  await insertFixtureMessage(
    db,
    {
      id: LOCAL_MAIL_VERIFY_MESSAGE_IDS.trash,
      mailboxId: staffPersonal,
      direction: "inbound",
      subject: fixtureSubject("Trash Message"),
      bodyText: "Local verification trash folder body.",
      receivedAt: fixtureTimestamp(20),
      trashedAt: fixtureTimestamp(15),
    },
    now,
  );

  await insertFixtureMessage(
    db,
    {
      id: LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedInbox,
      mailboxId: shared,
      direction: "inbound",
      subject: fixtureSubject("Shared Inbox"),
      bodyText: "Local verification shared mailbox inbox body.",
      receivedAt: fixtureTimestamp(4),
    },
    now,
  );

  await insertFixtureMessage(
    db,
    {
      id: LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc,
      mailboxId: shared,
      direction: "outbound",
      subject: fixtureSubject("Shared Bcc"),
      bodyText: "Local verification shared outbound body with Bcc.",
      sentAt: fixtureTimestamp(11),
      createdBy: LOCAL_MAIL_VERIFY_FIXTURE_ACTORS.staffA,
      senderIdentityId: LOCAL_MAIL_VERIFY_SENDER_IDENTITY_ID,
      recipients: [
        {
          id: `${LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc}-TO`,
          recipientType: "to",
          address: LOCAL_MAIL_VERIFY_ADDRESSES.toRecipient,
          sortOrder: 0,
        },
        {
          id: `${LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc}-CC`,
          recipientType: "cc",
          address: LOCAL_MAIL_VERIFY_ADDRESSES.ccRecipient,
          sortOrder: 1,
        },
        {
          id: `${LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc}-BCC`,
          recipientType: "bcc",
          address: LOCAL_MAIL_VERIFY_ADDRESSES.bccRecipient,
          sortOrder: 2,
        },
      ],
    },
    now,
  );

  const metadata: LocalMailVerifyFixtureMetadata[] = [
    {
      fixtureKey: "inboxBasic",
      messageId: LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxBasic,
      mailboxCategory: "staff_personal",
      direction: "inbound",
      projectedFolder: "inbox",
      hasHtml: false,
      hasQuoted: false,
      hasAttachmentMetadata: false,
      initialUnreadForStaffA: true,
    },
    {
      fixtureKey: "inboxHtml",
      messageId: LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxHtml,
      mailboxCategory: "staff_personal",
      direction: "inbound",
      projectedFolder: "inbox",
      hasHtml: true,
      hasQuoted: false,
      hasAttachmentMetadata: false,
      initialUnreadForStaffA: true,
    },
    {
      fixtureKey: "inboxQuoted",
      messageId: LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxQuoted,
      mailboxCategory: "staff_personal",
      direction: "inbound",
      projectedFolder: "inbox",
      hasHtml: false,
      hasQuoted: true,
      hasAttachmentMetadata: false,
      initialUnreadForStaffA: true,
    },
    {
      fixtureKey: "inboxAttachment",
      messageId: LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxAttachment,
      mailboxCategory: "staff_personal",
      direction: "inbound",
      projectedFolder: "inbox",
      hasHtml: false,
      hasQuoted: false,
      hasAttachmentMetadata: true,
      initialUnreadForStaffA: true,
    },
    {
      fixtureKey: "sent",
      messageId: LOCAL_MAIL_VERIFY_MESSAGE_IDS.sent,
      mailboxCategory: "staff_personal",
      direction: "outbound",
      projectedFolder: "sent",
      hasHtml: false,
      hasQuoted: false,
      hasAttachmentMetadata: false,
      initialUnreadForStaffA: true,
    },
    {
      fixtureKey: "trash",
      messageId: LOCAL_MAIL_VERIFY_MESSAGE_IDS.trash,
      mailboxCategory: "staff_personal",
      direction: "inbound",
      projectedFolder: "trash",
      hasHtml: false,
      hasQuoted: false,
      hasAttachmentMetadata: false,
      initialUnreadForStaffA: true,
    },
    {
      fixtureKey: "sharedInbox",
      messageId: LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedInbox,
      mailboxCategory: "shared",
      direction: "inbound",
      projectedFolder: "inbox",
      hasHtml: false,
      hasQuoted: false,
      hasAttachmentMetadata: false,
      initialUnreadForStaffA: true,
    },
    {
      fixtureKey: "sharedBcc",
      messageId: LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc,
      mailboxCategory: "shared",
      direction: "outbound",
      projectedFolder: "sent",
      hasHtml: false,
      hasQuoted: false,
      hasAttachmentMetadata: false,
      initialUnreadForStaffA: true,
    },
  ];

  return {
    mailboxIds: LOCAL_MAIL_VERIFY_MAILBOX_IDS,
    messageIds: LOCAL_MAIL_VERIFY_MESSAGE_IDS,
    metadata,
  };
}

export async function verifyLocalMailVerificationFixtures(
  db: Database,
): Promise<{
  messageCount: number;
  threadCount: number;
  bodyCount: number;
  recipientCount: number;
  attachmentCount: number;
  metadata: LocalMailVerifyFixtureMetadata[];
}> {
  const pattern = fixtureLikePattern();
  const messages = await db
    .select({ id: schema.mailMessages.id })
    .from(schema.mailMessages)
    .where(like(schema.mailMessages.id, pattern));

  const messageIds = messages.map((row) => row.id);
  const [bodies, recipients, attachments, threads] = await Promise.all([
    messageIds.length
      ? db
          .select({ messageId: schema.mailMessageBodies.messageId })
          .from(schema.mailMessageBodies)
          .where(inArray(schema.mailMessageBodies.messageId, messageIds))
      : Promise.resolve([]),
    messageIds.length
      ? db
          .select({ id: schema.mailMessageRecipients.id })
          .from(schema.mailMessageRecipients)
          .where(inArray(schema.mailMessageRecipients.messageId, messageIds))
      : Promise.resolve([]),
    messageIds.length
      ? db
          .select({ id: schema.mailMessageAttachments.id })
          .from(schema.mailMessageAttachments)
          .where(inArray(schema.mailMessageAttachments.messageId, messageIds))
      : Promise.resolve([]),
    db
      .select({ id: schema.mailThreads.id })
      .from(schema.mailThreads)
      .where(like(schema.mailThreads.id, pattern)),
  ]);

  const readStates =
    messageIds.length > 0
      ? await db
          .select({ messageId: schema.mailMessageReadStates.messageId })
          .from(schema.mailMessageReadStates)
          .where(
            and(
              inArray(schema.mailMessageReadStates.messageId, messageIds),
              eq(
                schema.mailMessageReadStates.userId,
                LOCAL_MAIL_VERIFY_FIXTURE_ACTORS.staffA,
              ),
            ),
          )
      : [];

  const unreadStaffA = new Set(readStates.map((row) => row.messageId));

  const metadata: LocalMailVerifyFixtureMetadata[] = (
    Object.keys(LOCAL_MAIL_VERIFY_MESSAGE_IDS) as Array<
      keyof typeof LOCAL_MAIL_VERIFY_MESSAGE_IDS
    >
  ).map((fixtureKey) => {
    const messageId = LOCAL_MAIL_VERIFY_MESSAGE_IDS[fixtureKey];
    const isShared =
      messageId === LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedInbox ||
      messageId === LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc;
    const projectedFolder =
      messageId === LOCAL_MAIL_VERIFY_MESSAGE_IDS.sent ||
      messageId === LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc
        ? "sent"
        : messageId === LOCAL_MAIL_VERIFY_MESSAGE_IDS.trash
          ? "trash"
          : "inbox";
    return {
      fixtureKey,
      messageId,
      mailboxCategory: isShared ? "shared" : "staff_personal",
      direction:
        messageId === LOCAL_MAIL_VERIFY_MESSAGE_IDS.sent ||
        messageId === LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc
          ? "outbound"
          : "inbound",
      projectedFolder,
      hasHtml: messageId === LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxHtml,
      hasQuoted: messageId === LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxQuoted,
      hasAttachmentMetadata:
        messageId === LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxAttachment,
      initialUnreadForStaffA: !unreadStaffA.has(messageId),
    };
  });

  return {
    messageCount: messageIds.length,
    threadCount: threads.length,
    bodyCount: bodies.length,
    recipientCount: recipients.length,
    attachmentCount: attachments.length,
    metadata,
  };
}

export async function countFixtureRows(db: Database): Promise<number> {
  const rows = await db
    .select({ id: schema.mailMessages.id })
    .from(schema.mailMessages)
    .where(like(schema.mailMessages.id, fixtureLikePattern()));
  return rows.length;
}

export async function countUnrelatedMailMessagesBeforeCleanup(
  db: Database,
  unrelatedMessageId: string,
): Promise<number> {
  const [row] = await db
    .select({ id: schema.mailMessages.id })
    .from(schema.mailMessages)
    .where(eq(schema.mailMessages.id, unrelatedMessageId))
    .limit(1);
  return row ? 1 : 0;
}
