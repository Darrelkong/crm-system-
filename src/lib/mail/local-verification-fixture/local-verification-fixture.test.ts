import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { schema } from "@/lib/db";
import {
  actor,
  makeRequireMailActor,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";
import { handleGetAccessibleMailboxes } from "@/app/api/mail/mailboxes/accessible/route";
import { handleGetMailMessages } from "@/app/api/mail/messages/route";
import { handleGetMailMessageDetail } from "@/app/api/mail/messages/[id]/route";
import { assertFixtureAddressesDoNotCollideWithCrmContacts } from "@/lib/mail/local-verification-fixture/collision";
import {
  LOCAL_MAIL_VERIFY_FIXTURE_PREFIX,
  LOCAL_MAIL_VERIFY_MAILBOX_IDS,
  LOCAL_MAIL_VERIFY_MESSAGE_IDS,
  LOCAL_MAIL_VERIFY_ADDRESSES,
} from "@/lib/mail/local-verification-fixture/constants";
import {
  assertLocalMailVerifyFixtureAllowed,
  LocalMailVerifyFixtureGuardError,
  parseLocalMailVerifyCliTarget,
} from "@/lib/mail/local-verification-fixture/guard";
import {
  cleanupLocalMailVerificationFixtures,
  connectLocalVerificationFixtureDb,
  countFixtureRows,
  setupLocalMailVerificationFixtures,
  verifyLocalMailVerificationFixtures,
} from "@/lib/mail/local-verification-fixture/service";

const OPT_IN = "CRM_ALLOW_LOCAL_MAIL_VERIFY_FIXTURE";

describe("local mail verification fixture guard", () => {
  it("rejects missing opt-in", () => {
    const previous = process.env[OPT_IN];
    delete process.env[OPT_IN];
    assert.throws(
      () =>
        assertLocalMailVerifyFixtureAllowed(
          parseLocalMailVerifyCliTarget(["--local"]),
        ),
      (error: unknown) => {
        assert.ok(error instanceof LocalMailVerifyFixtureGuardError);
        assert.equal(error.code, "OPT_IN_REQUIRED");
        return true;
      },
    );
    if (previous) process.env[OPT_IN] = previous;
  });

  it("rejects remote target", () => {
    const previous = process.env[OPT_IN];
    process.env[OPT_IN] = "1";
    assert.throws(
      () =>
        assertLocalMailVerifyFixtureAllowed(
          parseLocalMailVerifyCliTarget(["--local", "--remote"]),
        ),
      (error: unknown) => {
        assert.ok(error instanceof LocalMailVerifyFixtureGuardError);
        assert.equal(error.code, "REMOTE_FORBIDDEN");
        return true;
      },
    );
    if (previous) process.env[OPT_IN] = previous;
    else delete process.env[OPT_IN];
  });

  it("rejects missing --local flag", () => {
    const previous = process.env[OPT_IN];
    process.env[OPT_IN] = "1";
    assert.throws(
      () => assertLocalMailVerifyFixtureAllowed(parseLocalMailVerifyCliTarget([])),
      (error: unknown) => {
        assert.ok(error instanceof LocalMailVerifyFixtureGuardError);
        assert.equal(error.code, "LOCAL_FLAG_REQUIRED");
        return true;
      },
    );
    if (previous) process.env[OPT_IN] = previous;
    else delete process.env[OPT_IN];
  });
});

describe("local mail verification fixture service", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: TestDb;
  let unrelatedMessageId: string;
  let unrelatedMailboxId: string;

  before(async () => {
    process.env[OPT_IN] = "1";
    const connection = await connectLocalVerificationFixtureDb(
      parseLocalMailVerifyCliTarget(["--local"]),
    );
    db = connection.db as unknown as TestDb;
    dispose = connection.dispose;

    const now = new Date().toISOString();
    unrelatedMailboxId = "UNRELATED_2H3D5B_SURVIVOR_MB";
    unrelatedMessageId = "UNRELATED_2H3D5B_SURVIVOR_MSG";
    const threadId = `${unrelatedMessageId}-THREAD`;

    await db
      .delete(schema.mailMessageBodies)
      .where(eq(schema.mailMessageBodies.messageId, unrelatedMessageId));
    await db
      .delete(schema.mailMessages)
      .where(eq(schema.mailMessages.id, unrelatedMessageId));
    await db.delete(schema.mailThreads).where(eq(schema.mailThreads.id, threadId));
    await db
      .delete(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.mailboxId, unrelatedMailboxId));
    await db
      .delete(schema.mailMailboxes)
      .where(eq(schema.mailMailboxes.id, unrelatedMailboxId));

    await db.insert(schema.mailMailboxes).values({
      id: unrelatedMailboxId,
      address: "unrelated-2h3d5b-survivor@echfronthk.com",
      displayName: "Unrelated Survivor",
      mailboxType: "personal",
      status: "active",
      createdBy: SEED_IDS.staffA,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMailboxMembers).values({
      id: "UNRELATED_2H3D5B_SURVIVOR_MEMBER",
      mailboxId: unrelatedMailboxId,
      userId: SEED_IDS.staffA,
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
    await db.insert(schema.mailThreads).values({
      id: threadId,
      mailboxId: unrelatedMailboxId,
      subjectNormalized: "unrelated survivor",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessages).values({
      id: unrelatedMessageId,
      threadId,
      mailboxId: unrelatedMailboxId,
      direction: "inbound",
      fromAddress: "unrelated-survivor@echfronthk.test",
      fromDisplayName: "Unrelated",
      subject: "Unrelated surviving message",
      previewText: "survivor",
      receivedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessageBodies).values({
      messageId: unrelatedMessageId,
      bodyText: "Unrelated survivor body",
      createdAt: now,
      updatedAt: now,
    });
  });

  after(async () => {
    await db
      .delete(schema.mailMessageBodies)
      .where(eq(schema.mailMessageBodies.messageId, unrelatedMessageId));
    await db
      .delete(schema.mailMessages)
      .where(eq(schema.mailMessages.id, unrelatedMessageId));
    await db
      .delete(schema.mailThreads)
      .where(eq(schema.mailThreads.id, `${unrelatedMessageId}-THREAD`));
    await db
      .delete(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.mailboxId, unrelatedMailboxId));
    await db
      .delete(schema.mailMailboxes)
      .where(eq(schema.mailMailboxes.id, unrelatedMailboxId));
    process.env[OPT_IN] = "1";
    await cleanupLocalMailVerificationFixtures(db as unknown as TestDb);
    await dispose?.();
    delete process.env[OPT_IN];
  });

  it("passes CRM contact collision checks for fixture addresses", async () => {
    await assertFixtureAddressesDoNotCollideWithCrmContacts(db, [
      LOCAL_MAIL_VERIFY_ADDRESSES.inboundSender,
      LOCAL_MAIL_VERIFY_ADDRESSES.toRecipient,
    ]);
  });

  it("creates deterministic fixture dataset", async () => {
    const setup = await setupLocalMailVerificationFixtures(db);
    assert.equal(Object.keys(setup.messageIds).length, 8);
    const verified = await verifyLocalMailVerificationFixtures(db);
    assert.equal(verified.messageCount, 8);
    assert.equal(verified.bodyCount, 8);
    assert.equal(verified.attachmentCount, 1);
    assert.equal(verified.metadata.length, 8);
    assert.equal(
      verified.metadata.find((row) => row.fixtureKey === "inboxHtml")?.hasHtml,
      true,
    );
    assert.equal(
      verified.metadata.find((row) => row.fixtureKey === "sharedInbox")
        ?.mailboxCategory,
      "shared",
    );
  });

  it("is idempotent on second setup", async () => {
    await setupLocalMailVerificationFixtures(db);
    const second = await setupLocalMailVerificationFixtures(db);
    assert.equal(await countFixtureRows(db), 8);
    assert.equal(second.metadata.length, 8);
  });

  it("cleans up fixture rows without deleting unrelated mail", async () => {
    await setupLocalMailVerificationFixtures(db);
    await cleanupLocalMailVerificationFixtures(db);
    assert.equal(await countFixtureRows(db), 0);

    const [survivor] = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(eq(schema.mailMessages.id, unrelatedMessageId))
      .limit(1);
    assert.ok(survivor);
  });
});

describe("local mail verification fixture API smoke", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: TestDb;

  before(async () => {
    process.env[OPT_IN] = "1";
    const connection = await connectLocalVerificationFixtureDb(
      parseLocalMailVerifyCliTarget(["--local"]),
    );
    db = connection.db as unknown as TestDb;
    dispose = connection.dispose;
    await setupLocalMailVerificationFixtures(db);
  });

  after(async () => {
    await cleanupLocalMailVerificationFixtures(db);
    await dispose?.();
    delete process.env[OPT_IN];
  });

  it("returns authorized fixture mailboxes for Staff A", async () => {
    const res = await handleGetAccessibleMailboxes(
      new Request("http://localhost/api/mail/mailboxes/accessible"),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { items: Array<{ id: string }> };
    const ids = json.items.map((item) => item.id);
    assert.ok(ids.includes(LOCAL_MAIL_VERIFY_MAILBOX_IDS.staffPersonal));
    assert.ok(ids.includes(LOCAL_MAIL_VERIFY_MAILBOX_IDS.shared));
  });

  it("projects inbox, sent, and trash fixture folders for Staff A personal mailbox", async () => {
    const mailboxId = LOCAL_MAIL_VERIFY_MAILBOX_IDS.staffPersonal;
    const inbox = await handleGetMailMessages(
      new Request(
        `http://localhost/api/mail/messages?mailboxId=${mailboxId}&folder=inbox`,
      ),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const sent = await handleGetMailMessages(
      new Request(
        `http://localhost/api/mail/messages?mailboxId=${mailboxId}&folder=sent`,
      ),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const trash = await handleGetMailMessages(
      new Request(
        `http://localhost/api/mail/messages?mailboxId=${mailboxId}&folder=trash`,
      ),
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(inbox.status, 200);
    assert.equal(sent.status, 200);
    assert.equal(trash.status, 200);

    const inboxJson = (await inbox.json()) as { items: Array<{ id: string }> };
    const sentJson = (await sent.json()) as { items: Array<{ id: string }> };
    const trashJson = (await trash.json()) as { items: Array<{ id: string }> };

    assert.ok(
      inboxJson.items.some(
        (item) => item.id === LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxBasic,
      ),
    );
    assert.ok(
      sentJson.items.some((item) => item.id === LOCAL_MAIL_VERIFY_MESSAGE_IDS.sent),
    );
    assert.ok(
      trashJson.items.some(
        (item) => item.id === LOCAL_MAIL_VERIFY_MESSAGE_IDS.trash,
      ),
    );
  });

  it("returns sanitized HTML and trash-context detail", async () => {
    const htmlRes = await handleGetMailMessageDetail(
      new Request(
        `http://localhost/api/mail/messages/${LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxHtml}?folder=inbox`,
      ),
      LOCAL_MAIL_VERIFY_MESSAGE_IDS.inboxHtml,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(htmlRes.status, 200);
    const htmlJson = (await htmlRes.json()) as {
      item: { bodyHtml: string | null; quotedText: string | null };
    };
    assert.ok(htmlJson.item.bodyHtml?.includes("Local verify"));

    const trashDenied = await handleGetMailMessageDetail(
      new Request(
        `http://localhost/api/mail/messages/${LOCAL_MAIL_VERIFY_MESSAGE_IDS.trash}?folder=inbox`,
      ),
      LOCAL_MAIL_VERIFY_MESSAGE_IDS.trash,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(trashDenied.status, 403);

    const trashOk = await handleGetMailMessageDetail(
      new Request(
        `http://localhost/api/mail/messages/${LOCAL_MAIL_VERIFY_MESSAGE_IDS.trash}?folder=trash`,
      ),
      LOCAL_MAIL_VERIFY_MESSAGE_IDS.trash,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    assert.equal(trashOk.status, 200);
  });

  it("filters Bcc for Staff B while author Staff A retains Bcc visibility", async () => {
    const authorRes = await handleGetMailMessageDetail(
      new Request(
        `http://localhost/api/mail/messages/${LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc}?folder=sent`,
      ),
      LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)) },
    );
    const readerRes = await handleGetMailMessageDetail(
      new Request(
        `http://localhost/api/mail/messages/${LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc}?folder=sent`,
      ),
      LOCAL_MAIL_VERIFY_MESSAGE_IDS.sharedBcc,
      { requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffB)) },
    );
    assert.equal(authorRes.status, 200);
    assert.equal(readerRes.status, 200);
    const authorJson = (await authorRes.json()) as {
      item: { recipients: Array<{ recipientType: string }> };
    };
    const readerJson = (await readerRes.json()) as {
      item: { recipients: Array<{ recipientType: string }> };
    };
    assert.ok(
      authorJson.item.recipients.some(
        (recipient) => recipient.recipientType === "bcc",
      ),
    );
    assert.ok(
      !readerJson.item.recipients.some(
        (recipient) => recipient.recipientType === "bcc",
      ),
    );
  });

  it("uses fixture namespace prefix for all created message ids", async () => {
    const rows = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(eq(schema.mailMessages.mailboxId, LOCAL_MAIL_VERIFY_MAILBOX_IDS.shared));
    assert.ok(rows.every((row) => row.id.startsWith(LOCAL_MAIL_VERIFY_FIXTURE_PREFIX)));
  });
});
