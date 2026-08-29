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
  LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS,
  LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS,
  LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV,
} from "@/lib/mail/local-reply-verification-fixture/constants";
import {
  cleanupLocalMailReplyVerificationFixtures,
  setupLocalMailReplyVerificationFixtures,
  verifyLocalMailReplyVerificationFixtures,
} from "@/lib/mail/local-reply-verification-fixture/service";
import {
  getMessageDetail,
  listAccessibleMessages,
} from "@/lib/mail/mail-read-service";
import { createMailbox } from "@/lib/mail/mailbox-service";

const FIXTURE = "mail-detail-body-rel";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  adminGrants: MailActorContext["adminGrants"] = [],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants,
    audit: { ipAddress: "127.0.0.1", userAgent: "mail-detail-body-rel-test" },
  };
}

const adminActor = actor(SEED_IDS.admin, ["account_mgmt", "address_assignment"]);

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

async function insertMessage(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    direction: "inbound" | "outbound";
    bodyText: string;
  },
) {
  const now = new Date().toISOString();
  const threadId = `${input.id}-thread`;
  await db.insert(schema.mailThreads).values({
    id: threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: "detail-body-rel",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: input.direction,
    senderIdentityId: null,
    fromAddress: fixtureAddress("sender"),
    fromDisplayName: "Sender",
    subject: "Detail body relation",
    subjectNormalized: "detail body relation",
    previewText: input.bodyText.slice(0, 120),
    receivedAt: input.direction === "inbound" ? now : null,
    sentAt: input.direction === "outbound" ? now : null,
    trashedAt: null,
    composeMode: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: input.bodyText,
    bodyHtmlSanitized: `<p>${input.bodyText}</p>`,
    quotedText: null,
    quotedHtmlSanitized: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageRecipients).values({
    id: `${input.id}-to`,
    messageId: input.id,
    recipientType: "to",
    address: fixtureAddress("recipient"),
    displayName: null,
    sortOrder: 0,
    createdAt: now,
  });
}

async function cleanupFixtures(db: TestDb) {
  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);
  if (!mailboxIds.length) return;

  const messages = await db
    .select({ id: schema.mailMessages.id })
    .from(schema.mailMessages)
    .where(inArray(schema.mailMessages.mailboxId, mailboxIds));
  const messageIds = messages.map((row) => row.id);
  if (messageIds.length) {
    await db
      .delete(schema.mailMessageRecipients)
      .where(inArray(schema.mailMessageRecipients.messageId, messageIds));
    await db
      .delete(schema.mailMessageBodies)
      .where(inArray(schema.mailMessageBodies.messageId, messageIds));
    await db
      .delete(schema.mailMessages)
      .where(inArray(schema.mailMessages.id, messageIds));
  }

  await db
    .delete(schema.mailThreads)
    .where(inArray(schema.mailThreads.mailboxId, mailboxIds));
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

describe("mail message detail body relation", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let staffAMailboxId: string;
  let staffBMailboxId: string;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema }) as TestDb;
    bindTestDatabase(db);
    dispose = proxy.dispose;

    await cleanupFixtures(db);

    await enableMailAccess(db, SEED_IDS.staffA);
    await enableMailAccess(db, SEED_IDS.staffB);
    await enableMailAccess(db, SEED_IDS.admin);

    const staffA = await createMailbox(db, adminActor, {
      address: fixtureAddress("staff-a"),
      displayName: "Staff A detail body rel",
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });
    staffAMailboxId = staffA.id;

    const staffB = await createMailbox(db, adminActor, {
      address: fixtureAddress("staff-b"),
      displayName: "Staff B detail body rel",
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffB,
    });
    staffBMailboxId = staffB.id;
  });

  after(async () => {
    await cleanupFixtures(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("returns exact body for canonical message + body rows", async () => {
    const messageId = `${FIXTURE}-canonical`;
    const bodyText = "Exact canonical body text";
    await insertMessage(db, {
      id: messageId,
      mailboxId: staffAMailboxId,
      direction: "inbound",
      bodyText,
    });

    const detail = await getMessageDetail(db, actor(SEED_IDS.staffA), messageId, {
      folder: "inbox",
    });
    assert.equal(detail.bodyText, bodyText);
    assert.equal(detail.bodyHtml, `<p>${bodyText}</p>`);
  });

  it("keeps NOT_FOUND when body row is missing", async () => {
    const messageId = `${FIXTURE}-no-body-row`;
    await insertMessage(db, {
      id: messageId,
      mailboxId: staffAMailboxId,
      direction: "inbound",
      bodyText: "Will be deleted",
    });
    await db
      .delete(schema.mailMessageBodies)
      .where(eq(schema.mailMessageBodies.messageId, messageId));

    await assert.rejects(
      () =>
        getMessageDetail(db, actor(SEED_IDS.staffA), messageId, {
          folder: "inbox",
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "NOT_FOUND" &&
        error.message === "Message body not found",
    );
  });

  it("denies wrong mailbox reader without leaking body", async () => {
    const messageId = `${FIXTURE}-wrong-mailbox`;
    await insertMessage(db, {
      id: messageId,
      mailboxId: staffAMailboxId,
      direction: "inbound",
      bodyText: "Private mailbox body",
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

  it("does not return another message body for the requested id", async () => {
    const messageA = `${FIXTURE}-body-a`;
    const messageB = `${FIXTURE}-body-b`;
    await insertMessage(db, {
      id: messageA,
      mailboxId: staffAMailboxId,
      direction: "inbound",
      bodyText: "Body A only",
    });
    await insertMessage(db, {
      id: messageB,
      mailboxId: staffAMailboxId,
      direction: "inbound",
      bodyText: "Body B only",
    });
    await db
      .delete(schema.mailMessageBodies)
      .where(eq(schema.mailMessageBodies.messageId, messageA));

    await assert.rejects(
      () =>
        getMessageDetail(db, actor(SEED_IDS.staffA), messageA, {
          folder: "inbox",
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.message === "Message body not found",
    );

    const detailB = await getMessageDetail(db, actor(SEED_IDS.staffA), messageB, {
      folder: "inbox",
    });
    assert.equal(detailB.bodyText, "Body B only");
  });

  it("matches list row id to detail canonical message id", async () => {
    const messageId = `${FIXTURE}-list-id-match`;
    await insertMessage(db, {
      id: messageId,
      mailboxId: staffAMailboxId,
      direction: "inbound",
      bodyText: "List id match body",
    });

    const page = await listAccessibleMessages(db, actor(SEED_IDS.staffA), {
      mailboxId: staffAMailboxId,
      folder: "inbox",
    });
    const listItem = page.items.find((item) => item.id === messageId);
    assert.ok(listItem);

    const detail = await getMessageDetail(db, actor(SEED_IDS.staffA), listItem.id, {
      folder: "inbox",
    });
    assert.equal(detail.id, listItem.id);
    assert.equal(detail.bodyText, "List id match body");
  });
});

describe("LOCAL_MAIL_REPLY_VERIFY_2H6E list to detail path", () => {
  before(() => {
    process.env[LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV] = "1";
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  });

  it("fixture inbox list rows open detail with canonical bodies", async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    const db = drizzle(proxy.env.DB, { schema }) as TestDb;
    bindTestDatabase(db);
    try {
      await setupLocalMailReplyVerificationFixtures(db as never);
      const verified = await verifyLocalMailReplyVerificationFixtures(db as never);
      assert.equal(verified.fixtureBodiesComplete, true);
      assert.equal(verified.listDetailIdsMatch, true);

      const page = await listAccessibleMessages(db, actor(SEED_IDS.staffA), {
        mailboxId: LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS.staffA,
        folder: "inbox",
      });
      assert.ok(page.items.some((item) => item.id === LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReply));

      const detail = await getMessageDetail(
        db,
        actor(SEED_IDS.staffA),
        LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReply,
        { folder: "inbox" },
      );
      assert.equal(detail.id, LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS.inboundReply);
      assert.match(detail.bodyText, /Inbound reply fixture body/);
    } finally {
      await cleanupLocalMailReplyVerificationFixtures(db as never);
      await proxy.dispose();
    }
  });
});
