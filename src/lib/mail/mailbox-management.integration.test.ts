import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  createMailbox,
  findCurrentPrimaryReceivingAddress,
  findMailboxById,
  getMailbox,
  restoreMailbox,
  suspendMailbox,
} from "@/lib/mail/mailbox-service";
import {
  addReceivingAlias,
  getReceivingAddressById,
  restoreReceivingAddress,
  retireReceivingAddress,
  rotatePrimaryReceivingAddress,
  suspendReceivingAddress,
} from "@/lib/mail/receiving-address-service";
import {
  buildCoordinatedMailboxPostStateAuditInsert,
  runMailBatch,
} from "@/lib/mail/guarded-batch";

const FIXTURE = "mail-phase2c2";
const MAILBOX_A = `${FIXTURE}-mbox-a`;
const MAILBOX_B = `${FIXTURE}-mbox-b`;
const MAILBOX_ROTATION = `${FIXTURE}-mbox-rotation`;
const MAILBOX_SUSPEND = `${FIXTURE}-mbox-suspend`;

import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailAdminPermission[] = ["account_mgmt", "address_assignment"],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c2-test" },
  };
}

const accountMgmtActor = actor(SEED_IDS.staffB, ["account_mgmt"]);
const addressAssignActor = actor(SEED_IDS.staffB, ["address_assignment"]);
const fullActor = actor(SEED_IDS.admin, ["account_mgmt", "address_assignment"]);
const superAdminActor = actor(SEED_IDS.admin, ["super_admin"]);

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
  const fixtureMailboxes = [
    MAILBOX_A,
    MAILBOX_B,
    MAILBOX_ROTATION,
    MAILBOX_SUSPEND,
  ];

  const fixtureAddresses = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(
      or(
        like(schema.mailMailboxes.address, `${FIXTURE}%@echfronthk.com`),
        like(schema.mailMailboxes.id, `${FIXTURE}%`),
      ),
    );

  const mailboxIds = [
    ...fixtureMailboxes,
    ...fixtureAddresses.map((row) => row.id),
  ];

  if (mailboxIds.length > 0) {
    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));
  }

  await db
    .delete(schema.auditLogs)
    .where(
      or(
        like(schema.auditLogs.entityId, `${FIXTURE}%`),
        inArray(schema.auditLogs.entityId, mailboxIds),
        like(schema.auditLogs.action, "mail.%"),
      ),
    );

  const fixtureIdentityRows = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(
      or(
        like(schema.mailSenderIdentities.id, `${FIXTURE}%`),
        like(schema.mailSenderIdentities.address, `${FIXTURE}%@echfronthk.com`),
        inArray(schema.mailSenderIdentities.defaultMailboxId, mailboxIds),
        inArray(schema.mailSenderIdentities.sentFolderMailboxId, mailboxIds),
      ),
    );
  const identityIds = fixtureIdentityRows.map((row) => row.id);
  if (identityIds.length > 0) {
    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds));
    await db
      .delete(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.id, identityIds));
  }

  await db
    .delete(schema.mailMailboxes)
    .where(
      or(
        like(schema.mailMailboxes.id, `${FIXTURE}%`),
        like(schema.mailMailboxes.address, `${FIXTURE}%@echfronthk.com`),
      ),
    );

  await db
    .delete(schema.mailAdminGrants)
    .where(like(schema.mailAdminGrants.id, `${FIXTURE}%`));
}

async function insertFixtureMailbox(
  db: TestDb,
  id: string,
  address: string,
  primaryId: string,
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxes).values({
    id,
    address,
    mailboxType: "shared",
    status: "active",
    createdBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailReceivingAddresses).values({
    id: primaryId,
    mailboxId: id,
    address,
    addressType: "primary",
    status: "active",
    createdByUserId: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

describe("mail mailbox + receiving address management integration", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await enableMailAccess(db, SEED_IDS.admin);
    await cleanupFixtures(db);
  });

  after(async () => {
    try {
      await cleanupFixtures(db);
    } finally {
      bindTestDatabase(null);
      await dispose?.();
    }
  });

  it("createMailbox creates mailbox and current primary atomically", async () => {
    await cleanupFixtures(db);
    const address = fixtureAddress("create");
    const created = await createMailbox(db, fullActor, {
      address,
      mailboxType: "shared",
      displayName: "Fixture Create",
    });

    assert.ok(created.id);
    assert.equal(created.address, address.toLowerCase());
    assert.ok(created.currentPrimary);
    assert.equal(created.currentPrimary.addressType, "primary");
    assert.equal(created.currentPrimary.status, "active");
    assert.equal(created.currentPrimary.address, created.address);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.mailboxCreated),
          eq(schema.auditLogs.entityId, created.id),
        ),
      );
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.userId, SEED_IDS.admin);

    await cleanupFixtures(db);
  });

  it("createMailbox rolls back when primary insert would fail", async () => {
    await cleanupFixtures(db);
    const conflictAddress = fixtureAddress("atomic-conflict");
    await insertFixtureMailbox(
      db,
      MAILBOX_A,
      conflictAddress,
      `mra_primary_${MAILBOX_A}`,
    );
    await db.insert(schema.mailReceivingAddresses).values({
      id: `${FIXTURE}-alias-blocker`,
      mailboxId: MAILBOX_A,
      address: fixtureAddress("blocked"),
      addressType: "alias",
      status: "active",
      createdByUserId: SEED_IDS.admin,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await assert.rejects(
      () =>
        createMailbox(db, fullActor, {
          address: fixtureAddress("blocked"),
          mailboxType: "personal",
          ownerUserId: SEED_IDS.admin,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );

    const blockedMailboxes = await db
      .select()
      .from(schema.mailMailboxes)
      .where(eq(schema.mailMailboxes.address, fixtureAddress("blocked")));
    assert.equal(blockedMailboxes.length, 0, "mailbox must not exist without primary");

    await cleanupFixtures(db);
  });

  it("lifetime address conflict is case-insensitive", async () => {
    await cleanupFixtures(db);
    const created = await createMailbox(db, fullActor, {
      address: `${FIXTURE}-lifetime@ECHFRONTHK.COM`,
      mailboxType: "shared",
    });

    await insertFixtureMailbox(
      db,
      MAILBOX_B,
      fixtureAddress("other"),
      `mra_primary_${MAILBOX_B}`,
    );

    await assert.rejects(
      () =>
        addReceivingAlias(db, addressAssignActor, {
          mailboxId: MAILBOX_B,
          address: fixtureAddress("lifetime"),
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );

    const primaries = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, created.id));
    assert.equal(primaries.length, 1);

    await cleanupFixtures(db);
  });

  it("allows same normalized text on sender identity and receiving address", async () => {
    await cleanupFixtures(db);
    const sharedAddress = fixtureAddress("shared-text");
    const created = await createMailbox(db, fullActor, {
      address: sharedAddress,
      mailboxType: "personal",
      ownerUserId: SEED_IDS.admin,
    });

    const now = new Date().toISOString();
    await db.insert(schema.mailSenderIdentities).values({
      id: `${FIXTURE}-sender-identity`,
      address: sharedAddress,
      status: "active",
      defaultMailboxId: created.id,
      sentFolderMailboxId: created.id,
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    const identities = await db
      .select()
      .from(schema.mailSenderIdentities)
      .where(eq(schema.mailSenderIdentities.address, sharedAddress.toLowerCase()));
    assert.equal(identities.length, 1);

    await cleanupFixtures(db);
  });

  it("alias lifecycle: create, conflict, suspend, restore, retire", async () => {
    await cleanupFixtures(db);
    await insertFixtureMailbox(
      db,
      MAILBOX_A,
      fixtureAddress("a"),
      `mra_primary_${MAILBOX_A}`,
    );
    await insertFixtureMailbox(
      db,
      MAILBOX_B,
      fixtureAddress("b"),
      `mra_primary_${MAILBOX_B}`,
    );

    const aliasA = await addReceivingAlias(db, addressAssignActor, {
      mailboxId: MAILBOX_A,
      address: fixtureAddress("alias-a"),
    });
    const aliasB = await addReceivingAlias(db, addressAssignActor, {
      mailboxId: MAILBOX_A,
      address: fixtureAddress("alias-b"),
    });
    assert.equal(aliasA.status, "active");
    assert.equal(aliasB.status, "active");

    await assert.rejects(
      () =>
        addReceivingAlias(db, addressAssignActor, {
          mailboxId: MAILBOX_B,
          address: fixtureAddress("alias-a"),
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );

    const suspended = await suspendReceivingAddress(db, addressAssignActor, aliasA.id);
    assert.equal(suspended.status, "suspended");

    const restored = await restoreReceivingAddress(db, addressAssignActor, aliasA.id);
    assert.equal(restored.status, "active");

    const retired = await retireReceivingAddress(db, addressAssignActor, aliasA.id);
    assert.equal(retired.status, "retired");
    assert.ok(retired.retiredAt);

    await assert.rejects(
      () => restoreReceivingAddress(db, addressAssignActor, aliasA.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );

    await cleanupFixtures(db);
  });

  it("primary rotation retires old primary and updates mailbox address", async () => {
    await cleanupFixtures(db);
    const oldAddress = fixtureAddress("old-primary");
    const newAddress = fixtureAddress("new-primary");
    await insertFixtureMailbox(
      db,
      MAILBOX_ROTATION,
      oldAddress,
      `mra_primary_${MAILBOX_ROTATION}`,
    );

    const result = await rotatePrimaryReceivingAddress(db, addressAssignActor, {
      mailboxId: MAILBOX_ROTATION,
      newAddress,
    });

    assert.equal(result.oldPrimary.status, "retired");
    assert.ok(result.oldPrimary.retiredAt);
    assert.equal(result.newPrimary.status, "active");
    assert.equal(result.newPrimary.addressType, "primary");
    assert.equal(result.mailboxAddress, newAddress.toLowerCase());

    await insertFixtureMailbox(
      db,
      MAILBOX_B,
      fixtureAddress("rotation-b"),
      `mra_primary_${MAILBOX_B}`,
    );

    await assert.rejects(
      () =>
        addReceivingAlias(db, addressAssignActor, {
          mailboxId: MAILBOX_B,
          address: oldAddress,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );

    await cleanupFixtures(db);
  });

  it("failed primary rotation leaves no partial state", async () => {
    await cleanupFixtures(db);
    const oldAddress = fixtureAddress("rotate-old");
    const takenAddress = fixtureAddress("rotate-taken");
    await insertFixtureMailbox(
      db,
      MAILBOX_ROTATION,
      oldAddress,
      `mra_primary_${MAILBOX_ROTATION}`,
    );
    await insertFixtureMailbox(
      db,
      MAILBOX_B,
      takenAddress,
      `mra_primary_${MAILBOX_B}`,
    );

    await assert.rejects(
      () =>
        rotatePrimaryReceivingAddress(db, addressAssignActor, {
          mailboxId: MAILBOX_ROTATION,
          newAddress: takenAddress,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );

    const [mailbox] = await db
      .select()
      .from(schema.mailMailboxes)
      .where(eq(schema.mailMailboxes.id, MAILBOX_ROTATION));
    assert.equal(mailbox?.address, oldAddress);

    const primaries = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(
        and(
          eq(schema.mailReceivingAddresses.mailboxId, MAILBOX_ROTATION),
          eq(schema.mailReceivingAddresses.addressType, "primary"),
        ),
      );
    assert.equal(primaries.length, 1);
    assert.equal(primaries[0]?.status, "active");
    assert.equal(primaries[0]?.address, oldAddress);

    const rotationAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.receivingAddressRotated),
          eq(schema.auditLogs.entityId, `${FIXTURE}-should-not-exist`),
        ),
      );
    assert.equal(rotationAudits.length, 0);

    await cleanupFixtures(db);
  });

  it("suspend and restore mailbox coordinates current primary only", async () => {
    await cleanupFixtures(db);
    await insertFixtureMailbox(
      db,
      MAILBOX_SUSPEND,
      fixtureAddress("suspend"),
      `mra_primary_${MAILBOX_SUSPEND}`,
    );
    const alias = await addReceivingAlias(db, addressAssignActor, {
      mailboxId: MAILBOX_SUSPEND,
      address: fixtureAddress("suspend-alias"),
    });

    const suspended = await suspendMailbox(db, accountMgmtActor, MAILBOX_SUSPEND);
    assert.equal(suspended.status, "suspended");
    assert.equal(suspended.currentPrimary?.status, "suspended");

    const aliasAfterSuspend = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.id, alias.id));
    assert.equal(aliasAfterSuspend[0]?.status, "active");

    const restored = await restoreMailbox(db, accountMgmtActor, MAILBOX_SUSPEND);
    assert.equal(restored.status, "active");
    assert.equal(restored.currentPrimary?.status, "active");

    await cleanupFixtures(db);
  });

  it("account management grant is required to create mailbox", async () => {
    await assert.rejects(
      () =>
        createMailbox(db, addressAssignActor, {
          address: fixtureAddress("wrong-grant"),
          mailboxType: "personal",
          ownerUserId: SEED_IDS.staffA,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("rejects non-company and reserved addresses on create", async () => {
    await assert.rejects(
      () =>
        createMailbox(db, fullActor, {
          address: "user@gmail.com",
          mailboxType: "personal",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
    await assert.rejects(
      () =>
        createMailbox(db, fullActor, {
          address: "admin@echfronthk.com",
          mailboxType: "personal",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("address_assignment can read mailbox metadata but not create", async () => {
    await cleanupFixtures(db);
    const created = await createMailbox(db, fullActor, {
      address: fixtureAddress("read-access"),
      mailboxType: "shared",
    });
    const listed = await getMailbox(db, addressAssignActor, created.id);
    assert.equal(listed.id, created.id);
    await assert.rejects(
      () => suspendMailbox(db, addressAssignActor, created.id),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
    await cleanupFixtures(db);
  });

  it("super_admin can manage mailboxes and addresses", async () => {
    await cleanupFixtures(db);
    const created = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("super-admin"),
      mailboxType: "personal",
      ownerUserId: SEED_IDS.admin,
    });
    const alias = await addReceivingAlias(db, superAdminActor, {
      mailboxId: created.id,
      address: fixtureAddress("super-admin-alias"),
    });
    assert.equal(alias.status, "active");
    await cleanupFixtures(db);
  });

  it("stale suspend after rotation fails without mailbox/primary mismatch", async () => {
    await cleanupFixtures(db);
    const mailboxId = `${FIXTURE}-mbox-stale-suspend`;
    const oldAddress = fixtureAddress("stale-suspend-old");
    const newAddress = fixtureAddress("stale-suspend-new");
    const oldPrimaryId = `mra_primary_${mailboxId}`;

    await insertFixtureMailbox(db, mailboxId, oldAddress, oldPrimaryId);
    await rotatePrimaryReceivingAddress(db, addressAssignActor, {
      mailboxId,
      newAddress,
    });

    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();

    await assert.rejects(async () => {
      await runMailBatch(db, [
        db
          .update(schema.mailMailboxes)
          .set({ status: "suspended", updatedAt: now })
          .where(
            and(
              eq(schema.mailMailboxes.id, mailboxId),
              eq(schema.mailMailboxes.status, "active"),
            ),
          ),
        db
          .update(schema.mailReceivingAddresses)
          .set({ status: "suspended", updatedAt: now })
          .where(
            and(
              eq(schema.mailReceivingAddresses.id, oldPrimaryId),
              eq(schema.mailReceivingAddresses.mailboxId, mailboxId),
              eq(schema.mailReceivingAddresses.status, "active"),
              eq(schema.mailReceivingAddresses.addressType, "primary"),
            ),
          ),
        buildCoordinatedMailboxPostStateAuditInsert(
          db,
          accountMgmtActor,
          {
            mailboxId,
            primaryId: oldPrimaryId,
            expectedMailboxStatus: "suspended",
            expectedPrimaryStatus: "suspended",
          },
          {
            auditId,
            now,
            action: MAIL_AUDIT_ACTIONS.mailboxSuspended,
            entityId: mailboxId,
            entityType: "mail_mailbox",
            metadata: { mailboxId, stale: true },
          },
        ),
      ]);
    });

    const mailbox = await findMailboxById(db, mailboxId);
    assert.equal(mailbox?.status, "active");
    assert.equal(mailbox?.address, newAddress);

    const currentPrimary = await findCurrentPrimaryReceivingAddress(db, mailboxId);
    assert.equal(currentPrimary?.status, "active");
    assert.equal(currentPrimary?.address, newAddress);

    const oldPrimary = await getReceivingAddressById(db, oldPrimaryId);
    assert.equal(oldPrimary?.status, "retired");

    await cleanupFixtures(db);
  });

  it("stale restore after rotation fails without mailbox/primary mismatch", async () => {
    await cleanupFixtures(db);
    const mailboxId = `${FIXTURE}-mbox-stale-restore`;
    const oldAddress = fixtureAddress("stale-restore-old");
    const newAddress = fixtureAddress("stale-restore-new");
    const oldPrimaryId = `mra_primary_${mailboxId}`;

    await insertFixtureMailbox(db, mailboxId, oldAddress, oldPrimaryId);
    await suspendMailbox(db, accountMgmtActor, mailboxId);
    await rotatePrimaryReceivingAddress(db, addressAssignActor, {
      mailboxId,
      newAddress,
    });

    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();

    await assert.rejects(async () => {
      await runMailBatch(db, [
        db
          .update(schema.mailMailboxes)
          .set({ status: "active", updatedAt: now })
          .where(
            and(
              eq(schema.mailMailboxes.id, mailboxId),
              eq(schema.mailMailboxes.status, "suspended"),
            ),
          ),
        db
          .update(schema.mailReceivingAddresses)
          .set({ status: "active", updatedAt: now })
          .where(
            and(
              eq(schema.mailReceivingAddresses.id, oldPrimaryId),
              eq(schema.mailReceivingAddresses.mailboxId, mailboxId),
              eq(schema.mailReceivingAddresses.status, "suspended"),
              eq(schema.mailReceivingAddresses.addressType, "primary"),
            ),
          ),
        buildCoordinatedMailboxPostStateAuditInsert(
          db,
          accountMgmtActor,
          {
            mailboxId,
            primaryId: oldPrimaryId,
            expectedMailboxStatus: "active",
            expectedPrimaryStatus: "active",
          },
          {
            auditId,
            now,
            action: MAIL_AUDIT_ACTIONS.mailboxRestored,
            entityId: mailboxId,
            entityType: "mail_mailbox",
            metadata: { mailboxId, stale: true },
          },
        ),
      ]);
    });

    const mailbox = await findMailboxById(db, mailboxId);
    assert.equal(mailbox?.status, "suspended");
    assert.equal(mailbox?.address, newAddress);

    const currentPrimary = await findCurrentPrimaryReceivingAddress(db, mailboxId);
    assert.equal(currentPrimary?.status, "suspended");
    assert.equal(currentPrimary?.address, newAddress);

    await cleanupFixtures(db);
  });

  it("stale rotation after newer rotation does not overwrite current primary", async () => {
    await cleanupFixtures(db);
    const mailboxId = MAILBOX_ROTATION;
    const oldAddress = fixtureAddress("stale-rotate-old");
    const addressB = fixtureAddress("stale-rotate-b");
    const addressA = fixtureAddress("stale-rotate-a");
    const oldPrimaryId = `mra_primary_${mailboxId}`;

    await insertFixtureMailbox(db, mailboxId, oldAddress, oldPrimaryId);
    await rotatePrimaryReceivingAddress(db, addressAssignActor, {
      mailboxId,
      newAddress: addressB,
    });

    const stalePrimary = await getReceivingAddressById(db, oldPrimaryId);
    assert.equal(stalePrimary?.status, "retired");

    const currentBeforeStale = await findCurrentPrimaryReceivingAddress(
      db,
      mailboxId,
    );
    assert.equal(currentBeforeStale?.address, addressB);

    const now = new Date().toISOString();
    const staleNewPrimaryId = crypto.randomUUID();
    const auditId = crypto.randomUUID();

    await assert.rejects(async () => {
      await runMailBatch(db, [
        db
          .update(schema.mailReceivingAddresses)
          .set({ status: "retired", retiredAt: now, updatedAt: now })
          .where(
            and(
              eq(schema.mailReceivingAddresses.id, oldPrimaryId),
              eq(schema.mailReceivingAddresses.mailboxId, mailboxId),
              eq(schema.mailReceivingAddresses.addressType, "primary"),
              eq(schema.mailReceivingAddresses.status, "active"),
            ),
          ),
        db.insert(schema.mailReceivingAddresses).values({
          id: staleNewPrimaryId,
          mailboxId,
          address: addressA,
          addressType: "primary",
          status: "active",
          createdByUserId: SEED_IDS.admin,
          createdAt: now,
          updatedAt: now,
        }),
        db
          .update(schema.mailMailboxes)
          .set({ address: addressA, updatedAt: now })
          .where(
            and(
              eq(schema.mailMailboxes.id, mailboxId),
              eq(schema.mailMailboxes.address, oldAddress),
            ),
          ),
      ]);
    });

    const mailbox = await findMailboxById(db, mailboxId);
    assert.equal(mailbox?.address, addressB);

    const currentPrimary = await findCurrentPrimaryReceivingAddress(db, mailboxId);
    assert.equal(currentPrimary?.address, addressB);
    assert.notEqual(currentPrimary?.address, addressA);

    const staleInserted = await getReceivingAddressById(db, staleNewPrimaryId);
    assert.equal(staleInserted, null);

    await cleanupFixtures(db);
  });
});
