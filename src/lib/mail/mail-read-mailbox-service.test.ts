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
import { listAccessibleMailboxes } from "@/lib/mail/mail-read-mailbox-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-read-mailbox";

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
    audit: { ipAddress: "127.0.0.1", userAgent: "mail-read-mailbox-test" },
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
    canReply?: boolean;
    canSend?: boolean;
    revokedAt?: string | null;
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: input.id,
    mailboxId: input.mailboxId,
    userId: input.userId,
    canRead: input.canRead === false ? 0 : 1,
    canReply: input.canReply ? 1 : 0,
    canSend: input.canSend ? 1 : 0,
    canAssign: 0,
    canManageProcessing: 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    revokedAt: input.revokedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("mail read mailbox service", () => {
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

  it("returns personal mailbox ownership without membership", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("personal-owner"),
      mailboxType: "personal",
      displayName: "Alpha Personal",
    });
    const now = new Date().toISOString();
    await db
      .update(schema.mailMailboxes)
      .set({ createdBy: SEED_IDS.staffA, updatedAt: now })
      .where(eq(schema.mailMailboxes.id, mailbox.id));

    const items = await listAccessibleMailboxes(db, actor(SEED_IDS.staffA));
    const row = items.find((item) => item.id === mailbox.id);
    assert.ok(row);
    assert.equal(row.accessMode, "member");
    assert.equal(row.permissions.canRead, true);
    assert.equal(row.permissions.canReply, false);
    assert.equal(row.permissions.canSend, false);
  });

  it("returns shared mailbox membership with can_read", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("shared-member"),
      mailboxType: "shared",
      displayName: "Beta Shared",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-shared-member`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: true,
      canReply: true,
      canSend: false,
    });

    const items = await listAccessibleMailboxes(db, actor(SEED_IDS.staffA));
    const row = items.find((item) => item.id === mailbox.id);
    assert.ok(row);
    assert.equal(row.mailboxType, "shared");
    assert.equal(row.permissions.canRead, true);
    assert.equal(row.permissions.canReply, true);
  });

  it("excludes membership with can_read=0", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("no-read"),
      mailboxType: "shared",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-no-read`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: false,
    });

    const items = await listAccessibleMailboxes(db, actor(SEED_IDS.staffA));
    assert.ok(!items.some((item) => item.id === mailbox.id));
  });

  it("ignores revoked membership", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("revoked"),
      mailboxType: "shared",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-revoked`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: true,
      revokedAt: new Date().toISOString(),
    });

    const items = await listAccessibleMailboxes(db, actor(SEED_IDS.staffA));
    assert.ok(!items.some((item) => item.id === mailbox.id));
  });

  it("excludes suspended mailboxes", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("suspended"),
      mailboxType: "shared",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-suspended-member`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
    });
    await db
      .update(schema.mailMailboxes)
      .set({
        status: "suspended",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.mailMailboxes.id, mailbox.id));

    const items = await listAccessibleMailboxes(db, actor(SEED_IDS.staffA));
    assert.ok(!items.some((item) => item.id === mailbox.id));
  });

  it("returns all active mailboxes for explicit global_mail_read", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("global-only"),
      mailboxType: "shared",
      displayName: "Global Only",
    });

    const items = await listAccessibleMailboxes(
      db,
      actor(SEED_IDS.staffB, { adminGrants: ["global_mail_read"] }),
    );
    const row = items.find((item) => item.id === mailbox.id);
    assert.ok(row);
    assert.equal(row.accessMode, "global_read");
    assert.equal(row.permissions.canRead, true);
    assert.equal(row.permissions.canReply, false);
    assert.equal(row.permissions.canSend, false);
  });

  it("does not grant global visibility to super_admin alone", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("super-admin-hidden"),
      mailboxType: "shared",
    });

    const items = await listAccessibleMailboxes(
      db,
      actor(SEED_IDS.staffB, { adminGrants: ["super_admin"] }),
    );
    assert.ok(!items.some((item) => item.id === mailbox.id));
  });

  it("denies users without mail access", async () => {
    await assert.rejects(
      () =>
        listAccessibleMailboxes(
          db,
          actor(SEED_IDS.staffA, { mailAccessEnabled: false }),
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("returns safe DTO fields only", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("safe-dto"),
      mailboxType: "personal",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-safe-dto-member`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
    });

    const items = await listAccessibleMailboxes(db, actor(SEED_IDS.staffA));
    const row = items.find((item) => item.id === mailbox.id);
    assert.ok(row);
    assert.deepEqual(Object.keys(row).sort(), [
      "accessMode",
      "address",
      "displayName",
      "id",
      "mailboxType",
      "permissions",
    ]);
    assert.deepEqual(Object.keys(row.permissions).sort(), [
      "canRead",
      "canReply",
      "canSend",
    ]);
    assert.equal("createdBy" in row, false);
    assert.equal("revokedAt" in row, false);
  });

  it("returns global_read-only mailboxes with read-only permissions", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("global-read-only-perms"),
      mailboxType: "shared",
    });

    const items = await listAccessibleMailboxes(
      db,
      actor(SEED_IDS.staffB, { adminGrants: ["global_mail_read"] }),
    );
    const row = items.find((item) => item.id === mailbox.id);
    assert.ok(row);
    assert.equal(row.accessMode, "global_read");
    assert.equal(row.permissions.canRead, true);
    assert.equal(row.permissions.canReply, false);
    assert.equal(row.permissions.canSend, false);
  });

  it("prefers member access over global_mail_read with preserved permissions", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("member-over-global"),
      mailboxType: "shared",
      displayName: "Member Over Global",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-member-over-global`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: true,
      canReply: true,
      canSend: true,
    });

    const items = await listAccessibleMailboxes(
      db,
      actor(SEED_IDS.staffA, { adminGrants: ["global_mail_read"] }),
    );
    const row = items.find((item) => item.id === mailbox.id);
    assert.ok(row);
    assert.equal(row.accessMode, "member");
    assert.equal(row.permissions.canRead, true);
    assert.equal(row.permissions.canReply, true);
    assert.equal(row.permissions.canSend, true);
  });

  it("uses direct access for personal ownership even with global_mail_read", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("owner-over-global"),
      mailboxType: "personal",
      displayName: "Owner Over Global",
    });
    const now = new Date().toISOString();
    await db
      .update(schema.mailMailboxes)
      .set({ createdBy: SEED_IDS.staffA, updatedAt: now })
      .where(eq(schema.mailMailboxes.id, mailbox.id));

    const items = await listAccessibleMailboxes(
      db,
      actor(SEED_IDS.staffA, { adminGrants: ["global_mail_read"] }),
    );
    const row = items.find((item) => item.id === mailbox.id);
    assert.ok(row);
    assert.equal(row.accessMode, "member");
    assert.equal(row.mailboxType, "personal");
    assert.equal(row.permissions.canRead, true);
    assert.equal(row.permissions.canReply, false);
    assert.equal(row.permissions.canSend, false);
  });

  it("returns each mailbox exactly once when member and global_read both qualify", async () => {
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("single-row"),
      mailboxType: "shared",
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-single-row-member`,
      mailboxId: mailbox.id,
      userId: SEED_IDS.staffA,
      canRead: true,
      canReply: true,
      canSend: false,
    });

    const items = await listAccessibleMailboxes(
      db,
      actor(SEED_IDS.staffA, { adminGrants: ["global_mail_read"] }),
    );
    const matches = items.filter((item) => item.id === mailbox.id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.accessMode, "member");
  });

  it("orders personal before shared before global_read-only mailboxes", async () => {
    const personal = await createMailbox(db, adminActor, {
      address: fixtureAddress("order-personal"),
      mailboxType: "personal",
      displayName: "Zulu Personal",
    });
    const shared = await createMailbox(db, adminActor, {
      address: fixtureAddress("order-shared"),
      mailboxType: "shared",
      displayName: "Alpha Shared",
    });
    const globalOnly = await createMailbox(db, adminActor, {
      address: fixtureAddress("order-global"),
      mailboxType: "shared",
      displayName: "Middle Global",
    });

    await addMailboxMember(db, {
      id: `${FIXTURE}-order-personal-member`,
      mailboxId: personal.id,
      userId: SEED_IDS.staffA,
    });
    await addMailboxMember(db, {
      id: `${FIXTURE}-order-shared-member`,
      mailboxId: shared.id,
      userId: SEED_IDS.staffA,
    });

    const items = await listAccessibleMailboxes(
      db,
      actor(SEED_IDS.staffA, { adminGrants: ["global_mail_read"] }),
    );
    const ids = items
      .filter((item) =>
        [personal.id, shared.id, globalOnly.id].includes(item.id),
      )
      .map((item) => item.id);

    assert.deepEqual(ids, [personal.id, shared.id, globalOnly.id]);
  });
});
