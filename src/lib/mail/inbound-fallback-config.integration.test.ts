import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  getInboundFallbackMailboxConfig,
  setInboundFallbackMailbox,
} from "@/lib/mail/inbound-fallback-config-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import {
  assertMailDeliveryHealth,
  assertMailInboundFallbackConfigManagement,
} from "@/lib/permissions/mail";
import { MAIL_COMPANY_CONFIG_SINGLETON_ID } from "../../../drizzle/schema/mail-company-config";

const FIXTURE = "mail-phase2c9b";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailActorContext["adminGrants"] = [],
  crmRole: MailActorContext["crmRole"] = userId === SEED_IDS.admin ? "admin" : "staff",
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole,
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c9b-test" },
  };
}

const superAdminActor = actor(SEED_IDS.admin, ["super_admin"]);
const deliveryHealthActor = actor(SEED_IDS.staffA, ["delivery_health"]);
const accountMgmtActor = actor(SEED_IDS.staffA, ["account_mgmt"]);

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
  await db.delete(schema.mailCompanyConfig);
  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.action, `${MAIL_AUDIT_ACTIONS.inboundFallbackUpdated}%`));

  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);

  if (mailboxIds.length) {
    await db
      .delete(schema.mailReceivingAddresses)
      .where(like(schema.mailReceivingAddresses.address, `${FIXTURE}%`));
    for (const mailboxId of mailboxIds) {
      await db
        .delete(schema.mailMailboxMembers)
        .where(eq(schema.mailMailboxMembers.mailboxId, mailboxId));
    }
    await db
      .delete(schema.mailMailboxes)
      .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  }
}

async function insertFixtureMailbox(
  db: TestDb,
  input: {
    id: string;
    address: string;
    mailboxType: "personal" | "shared";
    status: "active" | "suspended" | "archived" | "deleted";
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxes).values({
    id: input.id,
    address: input.address,
    displayName: input.id,
    mailboxType: input.mailboxType,
    status: input.status,
    deletedAt: input.status === "deleted" ? now : null,
    createdBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

describe("0063 inbound fallback config Local D1", () => {
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
    await cleanupFixtures(db);
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
  });

  it("starts with zero company config rows allowed", async () => {
    await cleanupFixtures(db);
    const config = await getInboundFallbackMailboxConfig(db);
    assert.equal(config.configured, false);
    assert.equal(config.usable, false);
    assert.equal(config.unusableReason, "not_configured");

    const rows = await db.select().from(schema.mailCompanyConfig);
    assert.equal(rows.length, 0);
  });

  it("super_admin configures active shared fallback mailbox", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("fallback-a"),
      mailboxType: "shared",
    });

    const updated = await setInboundFallbackMailbox(db, superAdminActor, {
      mailboxId: mailbox.id,
    });
    assert.equal(updated.configured, true);
    assert.equal(updated.mailboxId, mailbox.id);
    assert.equal(updated.usable, true);

    const rows = await db.select().from(schema.mailCompanyConfig);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, MAIL_COMPANY_CONFIG_SINGLETON_ID);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.inboundFallbackUpdated));
    assert.equal(audits.length, 1);
    const meta = JSON.parse(audits[0]?.metadata ?? "{}") as {
      newMailboxId?: string;
    };
    assert.equal(meta.newMailboxId, mailbox.id);
  });

  it("updates same singleton config without competing rows", async () => {
    await cleanupFixtures(db);
    const first = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("fallback-b1"),
      mailboxType: "shared",
    });
    const second = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("fallback-b2"),
      mailboxType: "shared",
    });

    await setInboundFallbackMailbox(db, superAdminActor, { mailboxId: first.id });
    const updated = await setInboundFallbackMailbox(db, superAdminActor, {
      mailboxId: second.id,
    });
    assert.equal(updated.mailboxId, second.id);

    const rows = await db.select().from(schema.mailCompanyConfig);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.inboundFallbackMailboxId, second.id);
  });

  it("rejects unknown mailbox id", async () => {
    await cleanupFixtures(db);
    await assert.rejects(
      () =>
        setInboundFallbackMailbox(db, superAdminActor, {
          mailboxId: `${FIXTURE}-missing-mailbox`,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
    const rows = await db.select().from(schema.mailCompanyConfig);
    assert.equal(rows.length, 0);
  });

  it("rejects suspended/archived/deleted/personal fallback targets", async () => {
    await cleanupFixtures(db);
    const cases = [
      {
        id: `${FIXTURE}-suspended`,
        address: fixtureAddress("suspended"),
        status: "suspended" as const,
        mailboxType: "shared" as const,
      },
      {
        id: `${FIXTURE}-archived`,
        address: fixtureAddress("archived"),
        status: "archived" as const,
        mailboxType: "shared" as const,
      },
      {
        id: `${FIXTURE}-deleted`,
        address: fixtureAddress("deleted"),
        status: "deleted" as const,
        mailboxType: "shared" as const,
      },
      {
        id: `${FIXTURE}-personal`,
        address: fixtureAddress("personal"),
        status: "active" as const,
        mailboxType: "personal" as const,
      },
    ];

    for (const item of cases) {
      await insertFixtureMailbox(db, item);
      await assert.rejects(
        () =>
          setInboundFallbackMailbox(db, superAdminActor, { mailboxId: item.id }),
        (error: unknown) =>
          error instanceof MailServiceError && error.status === 400,
      );
    }

    const rows = await db.select().from(schema.mailCompanyConfig);
    assert.equal(rows.length, 0);
  });

  it("reports unusable when configured mailbox later becomes non-active", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("later-suspended"),
      mailboxType: "shared",
    });
    await setInboundFallbackMailbox(db, superAdminActor, { mailboxId: mailbox.id });

    await db
      .update(schema.mailMailboxes)
      .set({ status: "suspended", updatedAt: new Date().toISOString() })
      .where(eq(schema.mailMailboxes.id, mailbox.id));

    const config = await getInboundFallbackMailboxConfig(db);
    assert.equal(config.configured, true);
    assert.equal(config.usable, false);
    assert.equal(config.unusableReason, "mailbox_not_active");
  });

  it("authorization: super_admin may configure; delivery_health may not", async () => {
    assert.doesNotThrow(() =>
      assertMailInboundFallbackConfigManagement(superAdminActor),
    );
    assert.throws(
      () => assertMailInboundFallbackConfigManagement(deliveryHealthActor),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
    assert.throws(
      () => assertMailInboundFallbackConfigManagement(accountMgmtActor),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );
  });

  it("delivery_health helper allows delivery_health and super_admin only", () => {
    assert.doesNotThrow(() => assertMailDeliveryHealth(deliveryHealthActor));
    assert.doesNotThrow(() => assertMailDeliveryHealth(superAdminActor));
    assert.throws(() => assertMailDeliveryHealth(accountMgmtActor));
  });

  it("singleton CHECK rejects non-default id at DB level", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("singleton-check"),
      mailboxType: "shared",
    });
    const now = new Date().toISOString();
    await assert.rejects(
      () =>
        db.insert(schema.mailCompanyConfig).values({
          id: "not-default",
          inboundFallbackMailboxId: mailbox.id,
          updatedByUserId: SEED_IDS.admin,
          updatedAt: now,
        }),
      (error: unknown) => {
        const message =
          error instanceof Error
            ? `${error.message}${error.cause instanceof Error ? error.cause.message : ""}`
            : String(error);
        return /CHECK constraint failed|SQLITE_CONSTRAINT_CHECK/i.test(message);
      },
    );
  });
});

describe("0063 migration presence", () => {
  it("mail_company_config table exists in Local D1", async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    const db = drizzle(proxy.env.DB, { schema });
    const rows = await db.select().from(schema.mailCompanyConfig);
    assert.ok(Array.isArray(rows));
    proxy.dispose?.();
  });
});
