import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { handleGetAccessibleMailboxes } from "@/app/api/mail/mailboxes/accessible/route";
import { handleGetMailMessageDetail } from "@/app/api/mail/messages/[id]/route";
import {
  actor,
  adminActor,
  addMailboxMember,
  insertMessage,
  makeRequireMailActor,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import { listComposeContextOptions } from "@/lib/mail/compose-context-service";
import { MailServiceError } from "@/lib/mail/errors";
import {
  buildMailAdminCenterCapabilities,
  buildMailSessionContext,
  canAccessMailAdminCenter,
  resolveMailWorkspaceShellMode,
} from "@/lib/mail/mail-session-context";
import {
  hasEffectiveGlobalMailRead,
  hasEffectiveMailAccess,
  isCrmRootAdmin,
} from "@/lib/permissions/mail";
import * as schema from "../../../drizzle/schema";

const FIXTURE = "mail-root-admin";
let fixtureSeq = 0;

function uniqueFixtureAddress(localPart: string): string {
  fixtureSeq += 1;
  return `${FIXTURE}-${fixtureSeq}-${randomUUID().slice(0, 8)}-${localPart}@echfronthk.com`;
}

async function cleanupRootAdminFixtures(db: TestDb) {
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

    const drafts = await db
      .select({ id: schema.mailDrafts.id })
      .from(schema.mailDrafts)
      .where(inArray(schema.mailDrafts.mailboxId, mailboxIds));
    const draftIds = drafts.map((row) => row.id);
    if (draftIds.length) {
      await db
        .delete(schema.mailDraftRecipients)
        .where(inArray(schema.mailDraftRecipients.draftId, draftIds));
      await db
        .delete(schema.mailDraftAttachments)
        .where(inArray(schema.mailDraftAttachments.draftId, draftIds));
      await db
        .delete(schema.mailDrafts)
        .where(inArray(schema.mailDrafts.id, draftIds));
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
    .delete(schema.mailSenderIdentityGrants)
    .where(like(schema.mailSenderIdentityGrants.id, `${FIXTURE}%`));
  await db
    .delete(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));
}

function uniqueFixtureId(suffix: string): string {
  fixtureSeq += 1;
  return `${FIXTURE}-${fixtureSeq}-${randomUUID().slice(0, 8)}-${suffix}`;
}

function rootAdminActor() {
  return actor(SEED_IDS.admin, {
    crmRole: "admin",
    mailAccessEnabled: false,
    adminGrants: [],
  });
}

function delegatedAdminActor() {
  return actor(SEED_IDS.staffB, {
    crmRole: "staff",
    mailAccessEnabled: false,
    adminGrants: ["permission_mgmt"],
  });
}

describe("CRM root admin derived supervision", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;
    await cleanupRootAdminFixtures(db);
  });

  afterEach(async () => {
    await cleanupRootAdminFixtures(db);
  });

  after(async () => {
    await cleanupRootAdminFixtures(db);
    await teardownMailReadApiDb(db, dispose);
  });

  it("identifies canonical CRM root admin via users.role = admin", () => {
    assert.equal(isCrmRootAdmin(rootAdminActor()), true);
    assert.equal(
      isCrmRootAdmin(actor(SEED_IDS.staffA, { crmRole: "staff" })),
      false,
    );
  });

  it("grants effective mail access without mail_user_access row", () => {
    assert.equal(hasEffectiveMailAccess(rootAdminActor()), true);
    assert.equal(
      hasEffectiveMailAccess(
        actor(SEED_IDS.staffA, { mailAccessEnabled: false }),
      ),
      false,
    );
  });

  it("grants effective global read without persisted global_mail_read grant", () => {
    assert.equal(hasEffectiveGlobalMailRead(rootAdminActor()), true);
    assert.equal(
      hasEffectiveGlobalMailRead(
        actor(SEED_IDS.staffB, { adminGrants: ["permission_mgmt"] }),
      ),
      false,
    );
  });

  it("bootstrap: root admin opens admin center without mail access or grants", () => {
    const capabilities = buildMailAdminCenterCapabilities(rootAdminActor());
    assert.equal(canAccessMailAdminCenter(capabilities), true);
    assert.equal(capabilities.accessManagement, true);
    assert.equal(capabilities.mailboxManagement, true);
    assert.equal(capabilities.senderIdentityManagement, true);
  });

  it("blocks compose context without enabled mail user access", async () => {
    await assert.rejects(
      () => listComposeContextOptions(db, rootAdminActor()),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
  });

  it("session context exposes persisted vs effective fields", () => {
    const context = buildMailSessionContext(
      {
        id: SEED_IDS.admin,
        email: "admin@example.com",
        displayName: "Root Admin",
      },
      rootAdminActor(),
    );
    assert.equal(context.mailAccessEnabled, false);
    assert.equal(context.effectiveMailAccessEnabled, true);
    assert.equal(context.effectiveGlobalMailRead, true);
    assert.equal(context.isCrmRootAdmin, true);
  });

  it("resolves full workspace shell when persisted mail access is enabled", () => {
    assert.equal(
      resolveMailWorkspaceShellMode({
        mailAccessEnabled: true,
        canAccessMailAdminCenter: true,
      }),
      "full",
    );
  });

  it("resolves admin-only shell for root admin without persisted mail access", () => {
    assert.equal(
      resolveMailWorkspaceShellMode({
        mailAccessEnabled: false,
        canAccessMailAdminCenter: true,
      }),
      "admin_only",
    );
  });

  it("resolves admin-only shell for delegated mail admin", () => {
    const capabilities = buildMailAdminCenterCapabilities(delegatedAdminActor());
    assert.equal(
      resolveMailWorkspaceShellMode({
        mailAccessEnabled: false,
        canAccessMailAdminCenter: canAccessMailAdminCenter(capabilities),
      }),
      "admin_only",
    );
  });

  it("lists supervised mailboxes for root admin without membership", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: uniqueFixtureAddress("shared"),
      mailboxType: "shared",
    });
    await addMailboxMember(db, {
      id: uniqueFixtureId("member"),
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: true,
    });

    const res = await handleGetAccessibleMailboxes(
      new Request("http://localhost/api/mail/mailboxes/accessible"),
      { requireMailActor: makeRequireMailActor(db, rootAdminActor()) },
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      items: Array<{ id: string; accessMode: string }>;
    };
    const row = json.items.find((item) => item.id === mailbox.id);
    assert.ok(row, "expected supervised shared mailbox in accessible list");
    assert.equal(row.accessMode, "global_read");
  });

  it("denies delegated mail admin without data access from mailbox list", async () => {
    const res = await handleGetAccessibleMailboxes(
      new Request("http://localhost/api/mail/mailboxes/accessible"),
      { requireMailActor: makeRequireMailActor(db, delegatedAdminActor()) },
    );
    assert.equal(res.status, 403);
  });

  it("allows root admin to read staff shared mailbox message without membership", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: uniqueFixtureAddress("inbox"),
      mailboxType: "shared",
    });
    await addMailboxMember(db, {
      id: uniqueFixtureId("inbox-member"),
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: true,
    });
    const messageId = uniqueFixtureId("inbox-msg");
    await insertMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
      direction: "inbound",
      subject: `${FIXTURE} inbox`,
    });

    const detailRes = await handleGetMailMessageDetail(
      new Request(
        `http://localhost/api/mail/messages/${messageId}?folder=inbox`,
      ),
      messageId,
      { requireMailActor: makeRequireMailActor(db, rootAdminActor()) },
    );
    const detailBody = await detailRes.text();
    assert.equal(
      detailRes.status,
      200,
      `expected message detail 200, got ${detailRes.status}: ${detailBody}`,
    );
    const detail = JSON.parse(detailBody) as { item: { id: string } };
    assert.equal(detail.item.id, messageId);
  });

  it("does not grant root admin automatic canSend for staff-only identity", async () => {
    const composeAddress = uniqueFixtureAddress("compose");
    const mailbox = await createMailbox(db, adminActor, {
      address: composeAddress,
      mailboxType: "shared",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address: composeAddress,
      defaultMailboxId: mailbox.id,
    });
    await addMailboxMember(db, {
      id: uniqueFixtureId("compose-member"),
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canSend: true,
    });
    const now = new Date().toISOString();
    await db.insert(schema.mailSenderIdentityGrants).values({
      id: uniqueFixtureId("compose-grant"),
      senderIdentityId: identity.id,
      userId: SEED_IDS.staffA,
      canSend: 1,
      grantedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    const rootWithMailAccess = actor(SEED_IDS.admin, {
      crmRole: "admin",
      mailAccessEnabled: true,
      adminGrants: [],
    });
    const options = await listComposeContextOptions(db, rootWithMailAccess);
    assert.ok(
      !options.some((option) => option.senderIdentityId === identity.id),
      "root admin must not inherit staff sender identity canSend",
    );
  });

  it("does not insert mailbox membership rows for root admin supervision", async () => {
    const before = await db
      .select()
      .from(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.userId, SEED_IDS.admin));
    await handleGetAccessibleMailboxes(
      new Request("http://localhost/api/mail/mailboxes/accessible"),
      { requireMailActor: makeRequireMailActor(db, rootAdminActor()) },
    );
    const after = await db
      .select()
      .from(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.userId, SEED_IDS.admin));
    assert.equal(after.length, before.length);
  });

  it("does not insert global_mail_read grant for root admin", async () => {
    const before = await db
      .select()
      .from(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.userId, SEED_IDS.admin));
    await handleGetAccessibleMailboxes(
      new Request("http://localhost/api/mail/mailboxes/accessible"),
      { requireMailActor: makeRequireMailActor(db, rootAdminActor()) },
    );
    const after = await db
      .select()
      .from(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.userId, SEED_IDS.admin));
    assert.equal(after.length, before.length);
    assert.ok(!after.some((row) => row.permission === "global_mail_read"));
  });
});
