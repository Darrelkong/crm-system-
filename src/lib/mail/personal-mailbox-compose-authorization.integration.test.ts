import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { assertCanComposeFromIdentityInMailbox } from "@/lib/mail/compose-authorization";
import { listComposeContextOptions } from "@/lib/mail/compose-context-service";
import { MailServiceError } from "@/lib/mail/errors";
import { grantMailboxMember } from "@/lib/mail/mailbox-member-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "personal-compose-auth";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let fixtureSeq = 0;

function fixtureAddress(localPart: string): string {
  fixtureSeq += 1;
  return `${FIXTURE}-${fixtureSeq}-${randomUUID().slice(0, 8)}-${localPart}@echfronthk.com`;
}

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
    audit: { ipAddress: "127.0.0.1", userAgent: "personal-compose-auth-test" },
  };
}

const adminActor = actor(SEED_IDS.admin, {
  adminGrants: ["account_mgmt", "address_assignment"],
});

function rootAdminActor(): MailActorContext {
  return actor(SEED_IDS.admin, {
    mailAccessEnabled: false,
    adminGrants: [],
  });
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

  const identities = mailboxIds.length
    ? await db
        .select({ id: schema.mailSenderIdentities.id })
        .from(schema.mailSenderIdentities)
        .where(inArray(schema.mailSenderIdentities.defaultMailboxId, mailboxIds))
    : [];
  const identityIds = identities.map((row) => row.id);

  if (identityIds.length) {
    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(
        inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds),
      );
    await db
      .delete(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.id, identityIds));
  }

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

  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.entityId, `${FIXTURE}%`));
}

async function createIdentityGrant(
  db: TestDb,
  input: {
    address: string;
    mailboxId: string;
    grantUserId: string;
    displayName?: string;
  },
) {
  const identity = await createSenderIdentity(db, adminActor, {
    address: input.address,
    displayName: input.displayName ?? null,
    defaultMailboxId: input.mailboxId,
  });
  await grantSenderIdentityAccess(db, adminActor, {
    senderIdentityId: identity.id,
    targetUserId: input.grantUserId,
    canSend: true,
  });
  return identity;
}

describe("personal mailbox compose authorization", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;

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
    dispose?.();
  });

  it("authorizes personal owner with sender identity grant and canonical membership", async () => {
    const address = fixtureAddress("owner-no-member");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });
    const identity = await createIdentityGrant(db, {
      address,
      mailboxId: mailbox.id,
      grantUserId: SEED_IDS.staffA,
    });

    const members = await db
      .select()
      .from(schema.mailMailboxMembers)
      .where(eq(schema.mailMailboxMembers.mailboxId, mailbox.id));
    assert.equal(members.length, 1);
    assert.equal(members[0]?.userId, SEED_IDS.staffA);
    assert.equal(members[0]?.canRead, 1);

    const context = await assertCanComposeFromIdentityInMailbox(
      db,
      actor(SEED_IDS.staffA),
      { senderIdentityId: identity.id, mailboxId: mailbox.id },
    );
    assert.equal(context.membership, null);

    const options = await listComposeContextOptions(db, actor(SEED_IDS.staffA));
    assert.ok(
      options.some(
        (option) =>
          option.senderIdentityId === identity.id &&
          option.mailboxId === mailbox.id,
      ),
    );
  });

  it("denies personal owner without sender identity grant", async () => {
    const address = fixtureAddress("owner-no-grant");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    await assert.rejects(
      () =>
        assertCanComposeFromIdentityInMailbox(db, actor(SEED_IDS.staffA), {
          senderIdentityId: identity.id,
          mailboxId: mailbox.id,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("rejects canSend grant for non-owner on personal mailbox", async () => {
    const address = fixtureAddress("non-owner-grant");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    await assert.rejects(
      () =>
        grantSenderIdentityAccess(db, adminActor, {
          senderIdentityId: identity.id,
          targetUserId: SEED_IDS.staffB,
          canSend: true,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("denies root admin global_read without sender identity grant", async () => {
    const address = fixtureAddress("root-no-grant");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    await assert.rejects(
      () =>
        assertCanComposeFromIdentityInMailbox(db, rootAdminActor(), {
          senderIdentityId: identity.id,
          mailboxId: mailbox.id,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("authorizes shared mailbox member with canSend and sender identity grant", async () => {
    const address = fixtureAddress("shared-member");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "shared",
    });
    await grantMailboxMember(db, adminActor, {
      mailboxId: mailbox.id,
      targetUserId: SEED_IDS.staffA,
      canRead: true,
      canReply: true,
      canSend: true,
    });
    const identity = await createIdentityGrant(db, {
      address,
      mailboxId: mailbox.id,
      grantUserId: SEED_IDS.staffA,
    });

    const context = await assertCanComposeFromIdentityInMailbox(
      db,
      actor(SEED_IDS.staffA),
      { senderIdentityId: identity.id, mailboxId: mailbox.id },
    );
    assert.ok(context.membership);
  });

  it("rejects canSend grant when shared mailbox member lacks canSend", async () => {
    const address = fixtureAddress("shared-no-send");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "shared",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });
    await grantMailboxMember(db, adminActor, {
      mailboxId: mailbox.id,
      targetUserId: SEED_IDS.staffA,
      canRead: true,
      canReply: true,
      canSend: false,
    });

    await assert.rejects(
      () =>
        grantSenderIdentityAccess(db, adminActor, {
          senderIdentityId: identity.id,
          targetUserId: SEED_IDS.staffA,
          canSend: true,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("denies shared mailbox member without canSend even with legacy invalid grant row", async () => {
    const address = fixtureAddress("shared-no-send-compose");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "shared",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });
    await grantMailboxMember(db, adminActor, {
      mailboxId: mailbox.id,
      targetUserId: SEED_IDS.staffA,
      canRead: true,
      canReply: true,
      canSend: false,
    });
    const now = new Date().toISOString();
    await db.insert(schema.mailSenderIdentityGrants).values({
      id: randomUUID(),
      senderIdentityId: identity.id,
      userId: SEED_IDS.staffA,
      canReply: 0,
      canSend: 1,
      grantedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    await assert.rejects(
      () =>
        assertCanComposeFromIdentityInMailbox(db, actor(SEED_IDS.staffA), {
          senderIdentityId: identity.id,
          mailboxId: mailbox.id,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("rejects grantMailboxMember on personal mailbox", async () => {
    const address = fixtureAddress("personal-member-reject");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });

    await assert.rejects(
      () =>
        grantMailboxMember(db, adminActor, {
          mailboxId: mailbox.id,
          targetUserId: SEED_IDS.staffA,
          canRead: true,
          canReply: true,
          canSend: true,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("blocks canSend sender identity grant without mailbox send authorization", async () => {
    const address = fixtureAddress("grant-block");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.staffA,
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    await assert.rejects(
      () =>
        grantSenderIdentityAccess(db, adminActor, {
          senderIdentityId: identity.id,
          targetUserId: SEED_IDS.admin,
          canSend: true,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("returns empty compose options for root admin without sender identity grant", async () => {
    const address = fixtureAddress("root-empty-compose");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.admin,
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      defaultMailboxId: mailbox.id,
    });

    await assert.rejects(
      () => listComposeContextOptions(db, rootAdminActor()),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("authorizes Darrell personal mailbox owner with explicit sender identity grant", async () => {
    const address = fixtureAddress("darrell-recovery");
    const mailbox = await createMailbox(db, adminActor, {
      address,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.admin,
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address,
      displayName: "DarrellKoo",
      defaultMailboxId: mailbox.id,
    });
    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identity.id,
      targetUserId: SEED_IDS.admin,
      canSend: true,
    });

    const context = await assertCanComposeFromIdentityInMailbox(
      db,
      actor(SEED_IDS.admin, { crmRole: "admin", mailAccessEnabled: true }),
      { senderIdentityId: identity.id, mailboxId: mailbox.id },
    );
    assert.equal(context.identity.address, address);
    const options = await listComposeContextOptions(
      db,
      actor(SEED_IDS.admin, { crmRole: "admin", mailAccessEnabled: true }),
    );
    assert.ok(options.some((option) => option.senderIdentityId === identity.id));
  });
});
