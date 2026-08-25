import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import {
  buildMessageFolderConditions,
  resolveMessageFolderQuery,
} from "@/lib/mail/mail-folder-resolver";
import {
  getMessageDetail,
  listAccessibleMessages,
} from "@/lib/mail/mail-read-service";
import { getThreadSummary } from "@/lib/mail/mail-thread-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-read-svc";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  options: {
    crmRole?: "admin" | "staff";
    mailAccessEnabled?: boolean;
    adminGrants?: MailAdminPermission[];
  } = {},
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole:
      options.crmRole ?? (userId === SEED_IDS.admin ? "admin" : "staff"),
    mailAccessEnabled: options.mailAccessEnabled ?? true,
    adminGrants: options.adminGrants ?? [],
    audit: { ipAddress: "127.0.0.1", userAgent: "mail-read-svc-test" },
  };
}

const adminActor = actor(SEED_IDS.admin, {
  adminGrants: ["account_mgmt", "address_assignment"],
});

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

  if (mailboxIds.length) {
    const messages = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(inArray(schema.mailMessages.mailboxId, mailboxIds));
    const messageIds = messages.map((row) => row.id);

    if (messageIds.length) {
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

    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));

    const identities = await db
      .select({ id: schema.mailSenderIdentities.id })
      .from(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.defaultMailboxId, mailboxIds));
    if (identities.length) {
      await db
        .delete(schema.mailSenderIdentityGrants)
        .where(
          inArray(
            schema.mailSenderIdentityGrants.senderIdentityId,
            identities.map((row) => row.id),
          ),
        );
      await db
        .delete(schema.mailSenderIdentities)
        .where(inArray(schema.mailSenderIdentities.id, identities.map((row) => row.id)));
    }

    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, mailboxIds));
  }

  await db
    .delete(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));

  await db
    .delete(schema.mailStoredFiles)
    .where(like(schema.mailStoredFiles.id, `${FIXTURE}%`));
}

async function addMailboxMember(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    userId: string;
    canRead?: boolean;
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: input.id,
    mailboxId: input.mailboxId,
    userId: input.userId,
    canRead: input.canRead === false ? 0 : 1,
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

async function insertMessage(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    direction: "inbound" | "outbound";
    subject?: string;
    bodyText?: string;
    bodyHtml?: string | null;
    trashedAt?: string | null;
    receivedAt?: string;
    sentAt?: string | null;
    withBcc?: boolean;
    withAttachment?: boolean;
    senderIdentityId?: string;
  },
) {
  const now = new Date().toISOString();
  const threadId = `${input.id}-thread`;
  await db.insert(schema.mailThreads).values({
    id: threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: (input.subject ?? "Test").toLowerCase(),
    lastMessageAt: input.receivedAt ?? input.sentAt ?? now,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: input.direction,
    fromAddress:
      input.direction === "inbound"
        ? "client@example.com"
        : fixtureAddress("sender"),
    fromDisplayName: "Sender",
    subject: input.subject ?? "Test subject",
    previewText: "Preview snippet",
    receivedAt:
      input.direction === "inbound" ? (input.receivedAt ?? now) : null,
    sentAt:
      input.direction === "outbound" ? (input.sentAt ?? now) : input.sentAt ?? null,
    trashedAt: input.trashedAt ?? null,
    composeMode: input.direction === "outbound" ? "new" : null,
    senderIdentityId:
      input.direction === "outbound" ? (input.senderIdentityId ?? null) : null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: input.bodyText ?? "Secret body text",
    bodyHtmlSanitized: input.bodyHtml ?? "<p>Secret body html</p>",
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

  if (input.withBcc) {
    await db.insert(schema.mailMessageRecipients).values({
      id: `${input.id}-bcc`,
      messageId: input.id,
      recipientType: "bcc",
      address: "hidden@example.com",
      displayName: null,
      sortOrder: 1,
      createdAt: now,
    });
  }

  if (input.withAttachment) {
    const storedFileId = `${input.id}-file`;
    await db.insert(schema.mailStoredFiles).values({
      id: storedFileId,
      contentHash: "a".repeat(64),
      originalFilename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      storageProvider: "r2",
      storageBucket: "test",
      storageKey: `mail/inbound-attachments/${storedFileId}`,
      securityScanStatus: "clean",
      securityScannedAt: now,
      createdAt: now,
    });
    await db.insert(schema.mailMessageAttachments).values({
      id: `${input.id}-attachment`,
      messageId: input.id,
      storedFileId,
      contentHash: "a".repeat(64),
      originalFilename: "doc.pdf",
      displayFilename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      sortOrder: 0,
      deliveryMode: "direct_attachment",
      createdAt: now,
    });
  }

  return { id: input.id, threadId };
}

describe("mail folder resolver", () => {
  it("maps inbox, sent, and trash folders", () => {
    assert.deepEqual(resolveMessageFolderQuery("inbox"), {
      folder: "inbox",
      direction: "inbound",
      trashedOnly: false,
      orderColumn: "receivedAt",
    });
    assert.deepEqual(resolveMessageFolderQuery("sent"), {
      folder: "sent",
      direction: "outbound",
      trashedOnly: false,
      orderColumn: "sentAt",
    });
    assert.deepEqual(resolveMessageFolderQuery("trash"), {
      folder: "trash",
      direction: null,
      trashedOnly: true,
      orderColumn: "trashedAt",
    });
  });

  it("rejects workflow folders that do not query mail_messages", () => {
    for (const folder of ["drafts", "waiting_approval"] as const) {
      assert.throws(
        () => resolveMessageFolderQuery(folder),
        (error: unknown) =>
          error instanceof MailServiceError && error.errorCode === "VALIDATION",
      );
    }
  });

  it("builds folder conditions for inbox", () => {
    const spec = resolveMessageFolderQuery("inbox");
    const conditions = buildMessageFolderConditions("mailbox-1", spec);
    assert.ok(conditions.length >= 3);
  });
});

describe("mail read service", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let mailboxId: string;
  let senderIdentityId: string;

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

    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("shared"),
      mailboxType: "shared",
    });
    mailboxId = mailbox.id;
    const identity = await createSenderIdentity(db, adminActor, {
      address: fixtureAddress("identity"),
      defaultMailboxId: mailbox.id,
    });
    senderIdentityId = identity.id;
    await addMailboxMember(db, {
      id: `${FIXTURE}-reader`,
      mailboxId,
      userId: SEED_IDS.staffA,
    });
  });

  after(async () => {
    await cleanupFixtures(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("returns inbox messages for accessible mailbox without body or CRM fields", async () => {
    const inboundId = `${FIXTURE}-inbox-1`;
    await insertMessage(db, {
      id: inboundId,
      mailboxId,
      direction: "inbound",
      subject: "Inbox message",
      withAttachment: true,
    });
    await insertMessage(db, {
      id: `${FIXTURE}-sent-1`,
      mailboxId,
      direction: "outbound",
      subject: "Sent message",
      senderIdentityId,
    });

    const page = await listAccessibleMessages(db, actor(SEED_IDS.staffA), {
      mailboxId,
      folder: "inbox",
      limit: 20,
    });

    assert.ok(page.items.some((item) => item.id === inboundId));
    assert.ok(page.items.every((item) => item.direction === "inbound"));
    const row = page.items.find((item) => item.id === inboundId)!;
    assert.equal(row.hasAttachments, true);
    assert.equal(row.attachmentCount, 1);
    assert.equal(row.isUnread, true);

    for (const item of page.items) {
      assert.equal("bodyText" in item, false);
      assert.equal("bodyHtml" in item, false);
      assert.equal("customerAssociation" in item, false);
      assert.equal("recipients" in item, false);
    }
  });

  it("denies inaccessible mailbox for list", async () => {
    await assert.rejects(
      () =>
        listAccessibleMessages(db, actor(SEED_IDS.staffB), {
          mailboxId,
          folder: "inbox",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("returns sent and trash folder slices", async () => {
    const sentId = `${FIXTURE}-sent-folder`;
    const trashedId = `${FIXTURE}-trash-folder`;
    const trashedAt = "2026-08-20T10:00:00.000Z";

    await insertMessage(db, {
      id: sentId,
      mailboxId,
      direction: "outbound",
      subject: "Sent folder message",
      senderIdentityId: senderIdentityId,
    });
    await insertMessage(db, {
      id: trashedId,
      mailboxId,
      direction: "inbound",
      subject: "Trashed message",
      trashedAt,
    });

    const sentPage = await listAccessibleMessages(db, actor(SEED_IDS.staffA), {
      mailboxId,
      folder: "sent",
    });
    assert.ok(sentPage.items.some((item) => item.id === sentId));

    const trashPage = await listAccessibleMessages(db, actor(SEED_IDS.staffA), {
      mailboxId,
      folder: "trash",
    });
    assert.ok(trashPage.items.some((item) => item.id === trashedId));
  });

  it("returns message detail with body and attachments metadata", async () => {
    const messageId = `${FIXTURE}-detail`;
    const { threadId } = await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      bodyText: "Detailed body",
      bodyHtml: "<p>Detailed html</p>",
      withAttachment: true,
      withBcc: true,
    });

    const detail = await getMessageDetail(
      db,
      actor(SEED_IDS.staffA),
      messageId,
      { folder: "inbox" },
    );

    assert.equal(detail.id, messageId);
    assert.equal(detail.bodyText, "Detailed body");
    assert.equal(detail.bodyHtml, "<p>Detailed html</p>");
    assert.equal(detail.thread.id, threadId);
    assert.equal(detail.attachments.length, 1);
    assert.equal(detail.attachments[0]?.filename, "doc.pdf");
    assert.equal("storageKey" in (detail.attachments[0] ?? {}), false);
    assert.equal(detail.customerAssociation, null);
  });

  it("denies inaccessible message detail via not found", async () => {
    const messageId = `${FIXTURE}-private`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
    });

    await assert.rejects(
      () =>
        getMessageDetail(db, actor(SEED_IDS.staffB), messageId, {
          folder: "inbox",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "NOT_FOUND",
    );
  });

  it("filters bcc recipients for regular shared mailbox readers", async () => {
    const messageId = `${FIXTURE}-bcc-filter`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      withBcc: true,
    });

    const detail = await getMessageDetail(
      db,
      actor(SEED_IDS.staffA),
      messageId,
      { folder: "inbox" },
    );

    assert.deepEqual(
      detail.recipients.map((recipient) => recipient.recipientType),
      ["to"],
    );

    const globalDetail = await getMessageDetail(
      db,
      actor(SEED_IDS.staffB, { adminGrants: ["global_mail_read"] }),
      messageId,
      { folder: "inbox" },
    );
    assert.equal(globalDetail.recipients.length, 2);
  });

  it("returns thread summary for authorized mailbox", async () => {
    const messageId = `${FIXTURE}-thread-summary`;
    const { threadId } = await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      subject: "Thread subject",
    });

    const summary = await getThreadSummary(
      db,
      actor(SEED_IDS.staffA),
      threadId,
    );

    assert.equal(summary.id, threadId);
    assert.equal(summary.mailboxId, mailboxId);
    assert.ok(summary.messageCount >= 1);
    assert.ok(summary.latestMessageAt);
  });
});
