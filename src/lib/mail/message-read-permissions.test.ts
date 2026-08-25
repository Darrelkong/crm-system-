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
  assertCanReadMailbox,
  assertCanReadMessage,
  buildRecipientVisibilityContext,
  canViewerSeeBccRecipients,
  filterRecipientsForViewer,
  type MailReadAccessResult,
} from "@/lib/mail/message-read-permissions";
import { createMailbox } from "@/lib/mail/mailbox-service";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import type { MailMailbox } from "../../../drizzle/schema/mail-mailboxes";

const FIXTURE = "mail-read-perm";

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
    audit: { ipAddress: "127.0.0.1", userAgent: "mail-read-perm-test" },
  };
}

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
        .delete(schema.mailMessageRecipients)
        .where(inArray(schema.mailMessageRecipients.messageId, messageIds));
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
  input: {
    id: string;
    mailboxId: string;
    userId: string;
    canRead?: boolean;
    canManageProcessing?: boolean;
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
    canManageProcessing: input.canManageProcessing ? 1 : 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertInboundMessage(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    fromAddress?: string;
    trashedAt?: string | null;
    createdBy?: string | null;
  },
) {
  const now = new Date().toISOString();
  const threadId = `${input.id}-thread`;
  await db.insert(schema.mailThreads).values({
    id: threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: "test subject",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: "inbound",
    fromAddress: input.fromAddress ?? "client@example.com",
    fromDisplayName: "Client",
    subject: "Test subject",
    previewText: "Preview",
    receivedAt: now,
    trashedAt: input.trashedAt ?? null,
    createdBy: input.createdBy ?? null,
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

function mailboxAccessResult(
  mailbox: MailMailbox,
  accessMode: MailReadAccessResult["accessMode"] = "member",
): MailReadAccessResult {
  return {
    mailbox,
    membership: null,
    accessMode,
  };
}

describe("message read permissions — recipient privacy", () => {
  const sampleMailbox: MailMailbox = {
    id: "mb-1",
    address: "shared@example.com",
    displayName: null,
    mailboxType: "shared",
    status: "active",
    deletedAt: null,
    createdBy: SEED_IDS.admin,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const recipients = [
    {
      recipientType: "to" as const,
      address: "to@example.com",
      displayName: null,
      sortOrder: 0,
    },
    {
      recipientType: "cc" as const,
      address: "cc@example.com",
      displayName: null,
      sortOrder: 1,
    },
    {
      recipientType: "bcc" as const,
      address: "hidden@example.com",
      displayName: null,
      sortOrder: 2,
    },
  ];

  it("keeps to/cc visible and hides bcc for regular shared mailbox readers", () => {
    const viewer = actor(SEED_IDS.staffA);
    const context = buildRecipientVisibilityContext(
      viewer,
      {
        direction: "inbound",
        createdBy: null,
        fromAddress: "sender@example.com",
        mailboxId: sampleMailbox.id,
      },
      mailboxAccessResult(sampleMailbox, "member"),
    );

    const filtered = filterRecipientsForViewer(recipients, context);
    assert.deepEqual(
      filtered.map((row) => row.recipientType),
      ["to", "cc"],
    );
    assert.equal(canViewerSeeBccRecipients(context), false);
  });

  it("shows bcc for personal mailbox owners", () => {
    const ownerMailbox: MailMailbox = {
      ...sampleMailbox,
      mailboxType: "personal",
      createdBy: SEED_IDS.staffA,
    };
    const context = buildRecipientVisibilityContext(
      actor(SEED_IDS.staffA),
      {
        direction: "inbound",
        createdBy: null,
        fromAddress: "sender@example.com",
        mailboxId: ownerMailbox.id,
      },
      mailboxAccessResult(ownerMailbox, "member"),
    );

    assert.equal(canViewerSeeBccRecipients(context), true);
    assert.equal(filterRecipientsForViewer(recipients, context).length, 3);
  });

  it("shows bcc for outbound authors and global_mail_read viewers", () => {
    const authorContext = buildRecipientVisibilityContext(
      actor(SEED_IDS.staffA),
      {
        direction: "outbound",
        createdBy: SEED_IDS.staffA,
        fromAddress: "staff@example.com",
        mailboxId: sampleMailbox.id,
      },
      mailboxAccessResult(sampleMailbox, "member"),
    );
    assert.equal(canViewerSeeBccRecipients(authorContext), true);

    const globalContext = buildRecipientVisibilityContext(
      actor(SEED_IDS.staffB, { adminGrants: ["global_mail_read"] }),
      {
        direction: "inbound",
        createdBy: null,
        fromAddress: "sender@example.com",
        mailboxId: sampleMailbox.id,
      },
      mailboxAccessResult(sampleMailbox, "global_read"),
    );
    assert.equal(canViewerSeeBccRecipients(globalContext), true);
  });
});

describe("message read permissions — integration", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;

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
  });

  after(async () => {
    await cleanupFixtures(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("denies users without mail access", async () => {
    const adminActor = actor(SEED_IDS.admin, {
      adminGrants: ["account_mgmt", "address_assignment"],
    });
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("no-access"),
      mailboxType: "personal",
    });

    const blockedActor = actor(SEED_IDS.staffB, { mailAccessEnabled: false });
    await assert.rejects(
      () => assertCanReadMailbox(db, blockedActor, mailbox.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("allows personal mailbox members with can_read", async () => {
    const adminActor = actor(SEED_IDS.admin, {
      adminGrants: ["account_mgmt", "address_assignment"],
    });
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("personal-member"),
      mailboxType: "personal",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-personal-member`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: true,
    });

    const result = await assertCanReadMailbox(
      db,
      actor(SEED_IDS.staffA),
      mailbox.id,
    );
    assert.equal(result.accessMode, "member");
    assert.equal(result.mailbox.id, mailbox.id);
  });

  it("allows shared mailbox members with can_read and denies without it", async () => {
    const adminActor = actor(SEED_IDS.admin, {
      adminGrants: ["account_mgmt", "address_assignment"],
    });
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("shared-member"),
      mailboxType: "shared",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-shared-reader`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: true,
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-shared-blocked`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffB,
      canRead: false,
    });

    const allowed = await assertCanReadMailbox(
      db,
      actor(SEED_IDS.staffA),
      mailbox.id,
    );
    assert.equal(allowed.accessMode, "member");

    await assert.rejects(
      () => assertCanReadMailbox(db, actor(SEED_IDS.staffB), mailbox.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("allows global_mail_read without membership and denies super_admin alone", async () => {
    const adminActor = actor(SEED_IDS.admin, {
      adminGrants: ["account_mgmt", "address_assignment"],
    });
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("global-read"),
      mailboxType: "shared",
    });

    const globalReader = actor(SEED_IDS.staffA, {
      adminGrants: ["global_mail_read"],
    });
    const globalResult = await assertCanReadMailbox(
      db,
      globalReader,
      mailbox.id,
    );
    assert.equal(globalResult.accessMode, "global_read");
    assert.equal(globalResult.membership, null);

    const superOnly = actor(SEED_IDS.staffB, { adminGrants: ["super_admin"] });
    await assert.rejects(
      () => assertCanReadMailbox(db, superOnly, mailbox.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("denies suspended mailboxes", async () => {
    const adminActor = actor(SEED_IDS.admin, {
      adminGrants: ["account_mgmt", "address_assignment"],
    });
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("suspended"),
      mailboxType: "personal",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-suspended-member`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
    });

    const now = new Date().toISOString();
    await db
      .update(schema.mailMailboxes)
      .set({ status: "suspended", updatedAt: now })
      .where(eq(schema.mailMailboxes.id, mailbox.id));

    await assert.rejects(
      () => assertCanReadMailbox(db, actor(SEED_IDS.staffA), mailbox.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("allows readable messages and hides unauthorized mailbox existence", async () => {
    const adminActor = actor(SEED_IDS.admin, {
      adminGrants: ["account_mgmt", "address_assignment"],
    });
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("message-access"),
      mailboxType: "shared",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-message-reader`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
    });

    const messageId = `${FIXTURE}-message-allowed`;
    await insertInboundMessage(db, {
      id: messageId,
      mailboxId: mailbox.id,
    });

    const allowed = await assertCanReadMessage(
      db,
      actor(SEED_IDS.staffA),
      messageId,
      { folder: "inbox" },
    );
    assert.equal(allowed.message.id, messageId);

    await assert.rejects(
      () =>
        assertCanReadMessage(db, actor(SEED_IDS.staffB), messageId, {
          folder: "inbox",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "NOT_FOUND",
    );
  });

  it("returns not found for missing messages", async () => {
    await assert.rejects(
      () =>
        assertCanReadMessage(db, actor(SEED_IDS.staffA), `${FIXTURE}-missing`, {
          folder: "inbox",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "NOT_FOUND",
    );
  });

  it("enforces trash visibility rules", async () => {
    const adminActor = actor(SEED_IDS.admin, {
      adminGrants: ["account_mgmt", "address_assignment"],
    });
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("trash-rules"),
      mailboxType: "shared",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-trash-reader`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
    });

    const trashedId = `${FIXTURE}-message-trashed`;
    await insertInboundMessage(db, {
      id: trashedId,
      mailboxId: mailbox.id,
      trashedAt: new Date().toISOString(),
    });

    await assert.rejects(
      () =>
        assertCanReadMessage(db, actor(SEED_IDS.staffA), trashedId, {
          folder: "inbox",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    const allowed = await assertCanReadMessage(
      db,
      actor(SEED_IDS.staffA),
      trashedId,
      { folder: "trash" },
    );
    assert.equal(allowed.message.id, trashedId);
  });
});
