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
  getMessageDetail,
  listAccessibleMessages,
} from "@/lib/mail/mail-read-service";
import {
  getMessageReadStateForActor,
  updateMessageReadState,
} from "@/lib/mail/mail-read-state-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-read-state";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  options: {
    mailAccessEnabled?: boolean;
    adminGrants?: MailAdminPermission[];
  } = {},
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: options.mailAccessEnabled ?? true,
    adminGrants: options.adminGrants ?? [],
    audit: { ipAddress: "127.0.0.1", userAgent: "mail-read-state-test" },
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
    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, mailboxIds));
  }
}

async function addMailboxMember(
  db: TestDb,
  mailboxId: string,
  userId: string,
  memberId: string,
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: memberId,
    mailboxId,
    userId,
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
  db: TestDb,
  input: { id: string; mailboxId: string; trashedAt?: string | null },
) {
  const now = new Date().toISOString();
  const threadId = `${input.id}-thread`;
  await db.insert(schema.mailThreads).values({
    id: threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: "subject",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: "inbound",
    fromAddress: "client@example.com",
    fromDisplayName: "Client",
    subject: "Subject",
    previewText: "Preview",
    receivedAt: now,
    trashedAt: input.trashedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: "Body",
    createdAt: now,
    updatedAt: now,
  });
}

describe("mail read state service", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let mailboxId: string;
  let messageId: string;

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
    await addMailboxMember(db, mailboxId, SEED_IDS.staffA, `${FIXTURE}-member-a`);
    await addMailboxMember(db, mailboxId, SEED_IDS.staffB, `${FIXTURE}-member-b`);

    messageId = `${FIXTURE}-message-1`;
    await insertInboundMessage(db, { id: messageId, mailboxId });
  });

  after(async () => {
    await cleanupFixtures(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("projects missing row as unread", async () => {
    const state = await getMessageReadStateForActor(
      db,
      actor(SEED_IDS.staffA),
      messageId,
    );
    assert.equal(state.isRead, false);
    assert.equal(state.isImportantPersonal, false);
    assert.equal(state.readAt, null);
  });

  it("marks a message read with readAt", async () => {
    const updated = await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      messageId,
      { isRead: true },
      { folder: "inbox" },
    );
    assert.equal(updated.isRead, true);
    assert.ok(updated.readAt);
  });

  it("marks a message unread clearing readAt", async () => {
    await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      messageId,
      { isRead: true },
      { folder: "inbox" },
    );
    const unread = await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      messageId,
      { isRead: false },
      { folder: "inbox" },
    );
    assert.equal(unread.isRead, false);
    assert.equal(unread.readAt, null);
  });

  it("marks important without changing read state", async () => {
    const freshMessageId = `${FIXTURE}-important-only`;
    await insertInboundMessage(db, { id: freshMessageId, mailboxId });

    const updated = await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      freshMessageId,
      { isImportantPersonal: true },
      { folder: "inbox" },
    );
    assert.equal(updated.isImportantPersonal, true);
    assert.equal(updated.isRead, false);
    assert.equal(updated.readAt, null);
  });

  it("marks read without resetting important state", async () => {
    const freshMessageId = `${FIXTURE}-read-only`;
    await insertInboundMessage(db, { id: freshMessageId, mailboxId });

    await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      freshMessageId,
      { isImportantPersonal: true },
      { folder: "inbox" },
    );
    const read = await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      freshMessageId,
      { isRead: true },
      { folder: "inbox" },
    );
    assert.equal(read.isRead, true);
    assert.equal(read.isImportantPersonal, true);
  });

  it("is idempotent for repeated mark-read", async () => {
    const freshMessageId = `${FIXTURE}-idempotent-read`;
    await insertInboundMessage(db, { id: freshMessageId, mailboxId });

    const first = await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      freshMessageId,
      { isRead: true },
      { folder: "inbox" },
    );
    const second = await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      freshMessageId,
      { isRead: true },
      { folder: "inbox" },
    );
    assert.equal(second.isRead, true);
    assert.equal(second.readAt, first.readAt);
  });

  it("keeps independent read state per user", async () => {
    const freshMessageId = `${FIXTURE}-independent-read`;
    await insertInboundMessage(db, { id: freshMessageId, mailboxId });

    await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      freshMessageId,
      { isRead: true },
      { folder: "inbox" },
    );

    const staffBState = await getMessageReadStateForActor(
      db,
      actor(SEED_IDS.staffB),
      freshMessageId,
    );
    assert.equal(staffBState.isRead, false);
  });

  it("keeps independent important state per user", async () => {
    const freshMessageId = `${FIXTURE}-independent-important`;
    await insertInboundMessage(db, { id: freshMessageId, mailboxId });

    await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      freshMessageId,
      { isImportantPersonal: true },
      { folder: "inbox" },
    );

    const staffBState = await getMessageReadStateForActor(
      db,
      actor(SEED_IDS.staffB),
      freshMessageId,
    );
    assert.equal(staffBState.isImportantPersonal, false);
  });

  it("denies inaccessible message mutation with not found", async () => {
    const foreignMailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("foreign"),
      mailboxType: "shared",
    });
    const foreignMessageId = `${FIXTURE}-foreign`;
    await insertInboundMessage(db, {
      id: foreignMessageId,
      mailboxId: foreignMailbox.id,
    });

    await assert.rejects(
      () =>
        updateMessageReadState(
          db,
          actor(SEED_IDS.staffA),
          foreignMessageId,
          { isRead: true },
          { folder: "inbox" },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "NOT_FOUND",
    );
  });

  it("denies users without mail access", async () => {
    await assert.rejects(
      () =>
        updateMessageReadState(
          db,
          actor(SEED_IDS.staffA, { mailAccessEnabled: false }),
          messageId,
          { isRead: true },
          { folder: "inbox" },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("denies trashed message read-state mutation without trash context", async () => {
    const trashedMessageId = `${FIXTURE}-trashed-no-context`;
    await insertInboundMessage(db, {
      id: trashedMessageId,
      mailboxId,
      trashedAt: new Date().toISOString(),
    });

    await assert.rejects(
      () =>
        updateMessageReadState(
          db,
          actor(SEED_IDS.staffA),
          trashedMessageId,
          { isRead: true },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("marks trashed message read with trash context", async () => {
    const trashedMessageId = `${FIXTURE}-trashed-read`;
    await insertInboundMessage(db, {
      id: trashedMessageId,
      mailboxId,
      trashedAt: new Date().toISOString(),
    });

    const updated = await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      trashedMessageId,
      { isRead: true },
      { folder: "trash" },
    );
    assert.equal(updated.isRead, true);
    assert.ok(updated.readAt);
  });

  it("marks trashed message unread with trash context", async () => {
    const trashedMessageId = `${FIXTURE}-trashed-unread`;
    await insertInboundMessage(db, {
      id: trashedMessageId,
      mailboxId,
      trashedAt: new Date().toISOString(),
    });

    await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      trashedMessageId,
      { isRead: true },
      { folder: "trash" },
    );
    const unread = await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      trashedMessageId,
      { isRead: false },
      { folder: "trash" },
    );
    assert.equal(unread.isRead, false);
    assert.equal(unread.readAt, null);
  });

  it("updates trashed message personal-important state with trash context", async () => {
    const trashedMessageId = `${FIXTURE}-trashed-important`;
    await insertInboundMessage(db, {
      id: trashedMessageId,
      mailboxId,
      trashedAt: new Date().toISOString(),
    });

    const updated = await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      trashedMessageId,
      { isImportantPersonal: true },
      { folder: "trash" },
    );
    assert.equal(updated.isImportantPersonal, true);
    assert.equal(updated.isRead, false);
  });

  it("denies trashed message mutation for unauthorized mailbox even with trash context", async () => {
    const foreignMailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("foreign-trash"),
      mailboxType: "shared",
    });
    const trashedMessageId = `${FIXTURE}-foreign-trashed`;
    await insertInboundMessage(db, {
      id: trashedMessageId,
      mailboxId: foreignMailbox.id,
      trashedAt: new Date().toISOString(),
    });

    await assert.rejects(
      () =>
        updateMessageReadState(
          db,
          actor(SEED_IDS.staffA),
          trashedMessageId,
          { isRead: true },
          { folder: "trash" },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "NOT_FOUND",
    );
  });

  it("leaves non-trash inbox message behavior unchanged", async () => {
    const freshMessageId = `${FIXTURE}-non-trash-unchanged`;
    await insertInboundMessage(db, { id: freshMessageId, mailboxId });

    const updated = await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      freshMessageId,
      { isRead: true },
      { folder: "inbox" },
    );
    assert.equal(updated.isRead, true);
    assert.ok(updated.readAt);
  });

  it("reflects mutations in list and detail projections", async () => {
    const freshMessageId = `${FIXTURE}-projection`;
    await insertInboundMessage(db, { id: freshMessageId, mailboxId });

    await updateMessageReadState(
      db,
      actor(SEED_IDS.staffA),
      freshMessageId,
      { isRead: true, isImportantPersonal: true },
      { folder: "inbox" },
    );

    const detail = await getMessageDetail(
      db,
      actor(SEED_IDS.staffA),
      freshMessageId,
      { folder: "inbox" },
    );
    assert.equal(detail.isUnread, false);
    assert.equal(detail.isImportantPersonal, true);

    const list = await listAccessibleMessages(db, actor(SEED_IDS.staffA), {
      mailboxId,
      folder: "inbox",
    });
    const row = list.items.find((item) => item.id === freshMessageId);
    assert.ok(row);
    assert.equal(row.isUnread, false);
    assert.equal(row.isImportantPersonal, true);
  });
});
