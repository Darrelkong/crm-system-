import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { schema } from "@/lib/db";
import { assertFixtureAddressesDoNotCollideWithCrmContacts } from "@/lib/mail/local-verification-fixture/collision";
import {
  LOCAL_MAIL_VERIFY_ADDRESSES,
  LOCAL_MAIL_VERIFY_FIXTURE_PREFIX,
} from "@/lib/mail/local-verification-fixture/constants";
import {
  cleanupLocalMailVerificationFixtures,
  connectLocalVerificationFixtureDb,
  setupLocalMailVerificationFixtures,
  verifyLocalMailVerificationFixtures,
} from "@/lib/mail/local-verification-fixture/service";
import { parseLocalMailVerifyCliTarget } from "@/lib/mail/local-verification-fixture/guard";
import {
  LOCAL_MAIL_CRM_VERIFY_ADDRESSES,
  LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS,
  LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX,
  LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS,
  LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS,
} from "@/lib/mail/local-crm-verification-fixture/constants";
import {
  assertLocalMailCrmVerifyFixtureAllowed,
  LocalMailCrmVerifyFixtureGuardError,
  parseLocalMailCrmVerifyCliTarget,
} from "@/lib/mail/local-crm-verification-fixture/guard";
import {
  cleanupLocalMailCrmVerificationFixtures,
  connectLocalCrmVerificationFixtureDb,
  setupLocalMailCrmVerificationFixtures,
  verifyLocalMailCrmCustomerAccess,
  verifyLocalMailCrmVerificationApiSecurity,
  verifyLocalMailCrmVerificationFixtures,
} from "@/lib/mail/local-crm-verification-fixture/service";
import type { Database } from "@/lib/db";
import { bindTestDatabase } from "@/lib/db";

const OPT_IN = "CRM_ALLOW_LOCAL_MAIL_CRM_VERIFY_FIXTURE";
const OPT_IN_5B = "CRM_ALLOW_LOCAL_MAIL_VERIFY_FIXTURE";

type TestDb = Database;

describe("local mail CRM verification fixture guard", () => {
  it("rejects missing opt-in", () => {
    const previous = process.env[OPT_IN];
    delete process.env[OPT_IN];
    assert.throws(
      () =>
        assertLocalMailCrmVerifyFixtureAllowed(
          parseLocalMailCrmVerifyCliTarget(["--local"]),
        ),
      (error: unknown) => {
        assert.ok(error instanceof LocalMailCrmVerifyFixtureGuardError);
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
        assertLocalMailCrmVerifyFixtureAllowed(
          parseLocalMailCrmVerifyCliTarget(["--local", "--remote"]),
        ),
      (error: unknown) => {
        assert.ok(error instanceof LocalMailCrmVerifyFixtureGuardError);
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
      () =>
        assertLocalMailCrmVerifyFixtureAllowed(parseLocalMailCrmVerifyCliTarget([])),
      (error: unknown) => {
        assert.ok(error instanceof LocalMailCrmVerifyFixtureGuardError);
        assert.equal(error.code, "LOCAL_FLAG_REQUIRED");
        return true;
      },
    );
    if (previous) process.env[OPT_IN] = previous;
    else delete process.env[OPT_IN];
  });
});

describe("local mail CRM verification fixture service", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: TestDb;
  let unrelatedCustomerId: string;

  before(async () => {
    process.env[OPT_IN] = "1";
    const connection = await connectLocalCrmVerificationFixtureDb(
      parseLocalMailCrmVerifyCliTarget(["--local"]),
    );
    db = connection.db;
    dispose = connection.dispose;

    unrelatedCustomerId = "UNRELATED_2H4B2_SURVIVOR_CUST";
    const now = new Date().toISOString();
    await db
      .delete(schema.customerContactIdentifiers)
      .where(eq(schema.customerContactIdentifiers.customerId, unrelatedCustomerId));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, unrelatedCustomerId));

    await db.insert(schema.customers).values({
      id: unrelatedCustomerId,
      customerCode: "UNREL2H4B2",
      customerName: "Unrelated CRM Survivor",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+852",
      source: "local_fixture",
      salesStage: "new_lead",
      ownerId: SEED_IDS.staffB,
      status: "active",
      createdBy: SEED_IDS.admin,
      updatedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });
  });

  after(async () => {
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, unrelatedCustomerId));
    process.env[OPT_IN] = "1";
    await cleanupLocalMailCrmVerificationFixtures(db);
    await dispose?.();
    delete process.env[OPT_IN];
  });

  it("creates expected CRM customers", async () => {
    await setupLocalMailCrmVerificationFixtures(db);
    const customers = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        inArray(schema.customers.id, Object.values(LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS)),
      );
    assert.equal(customers.length, 3);
  });

  it("creates expected contact identifiers", async () => {
    const identifiers = await db
      .select({
        customerId: schema.customerContactIdentifiers.customerId,
        normalizedValue: schema.customerContactIdentifiers.normalizedValue,
      })
      .from(schema.customerContactIdentifiers)
      .where(
        inArray(
          schema.customerContactIdentifiers.customerId,
          [
            LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS.accessibleA,
            LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS.publicPool,
          ],
        ),
      );
    assert.equal(identifiers.length, 2);
    const normalized = identifiers.map((row) => row.normalizedValue).sort();
    assert.deepEqual(normalized, [
      LOCAL_MAIL_CRM_VERIFY_ADDRESSES.customerAEmail.toLowerCase(),
      LOCAL_MAIL_CRM_VERIFY_ADDRESSES.publicPoolEmail.toLowerCase(),
    ]);
  });

  it("creates expected mailbox and messages", async () => {
    const verified = await verifyLocalMailCrmVerificationFixtures(db);
    assert.equal(verified.messageCount, 4);
    assert.equal(verified.customerCount, 3);
    assert.ok(
      verified.subjects.includes("[LOCAL CRM VERIFY] Accessible Customer"),
    );
    assert.ok(
      verified.subjects.includes("[LOCAL CRM VERIFY] Public Pool Customer"),
    );
    assert.ok(
      verified.subjects.includes("[LOCAL CRM VERIFY] External No Match"),
    );
    assert.ok(
      verified.subjects.includes("[LOCAL CRM VERIFY] Outbound Manual Association"),
    );

    const [mailbox] = await db
      .select({ id: schema.mailMailboxes.id })
      .from(schema.mailMailboxes)
      .where(eq(schema.mailMailboxes.id, LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS.shared))
      .limit(1);
    assert.ok(mailbox);
  });

  it("is idempotent on second setup", async () => {
    await setupLocalMailCrmVerificationFixtures(db);
    const second = await setupLocalMailCrmVerificationFixtures(db);
    const verified = await verifyLocalMailCrmVerificationFixtures(db);
    assert.equal(verified.messageCount, 4);
    assert.equal(Object.keys(second.messageIds).length, 4);
  });

  it("cleans up only the 4B-2 namespace", async () => {
    await setupLocalMailCrmVerificationFixtures(db);
    await cleanupLocalMailCrmVerificationFixtures(db);
    const verified = await verifyLocalMailCrmVerificationFixtures(db);
    assert.equal(verified.messageCount, 0);
    assert.equal(verified.customerCount, 0);

    const fixtureRows = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(eq(schema.mailMessages.id, LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.accessibleCustomer));
    assert.equal(fixtureRows.length, 0);
  });

  it("leaves unrelated CRM customers intact after cleanup", async () => {
    await setupLocalMailCrmVerificationFixtures(db);
    await cleanupLocalMailCrmVerificationFixtures(db);
    const [survivor] = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.id, unrelatedCustomerId))
      .limit(1);
    assert.ok(survivor);
  });

  it("preserves the 5B fixture through setup and cleanup", async () => {
    process.env[OPT_IN_5B] = "1";
    const connection5b = await connectLocalVerificationFixtureDb(
      parseLocalMailVerifyCliTarget(["--local"]),
    );
    try {
      await setupLocalMailVerificationFixtures(connection5b.db);
      const before5b = await verifyLocalMailVerificationFixtures(connection5b.db);

      await setupLocalMailCrmVerificationFixtures(db);
      const during5b = await verifyLocalMailVerificationFixtures(connection5b.db);
      assert.equal(during5b.messageCount, before5b.messageCount);

      await cleanupLocalMailCrmVerificationFixtures(db);
      const after5b = await verifyLocalMailVerificationFixtures(connection5b.db);
      assert.equal(after5b.messageCount, before5b.messageCount);
      assert.ok(
        after5b.metadata.every((row) =>
          row.messageId.startsWith(LOCAL_MAIL_VERIFY_FIXTURE_PREFIX),
        ),
      );
      assert.ok(
        !after5b.metadata.some(
          (row) => row.messageId === LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS.accessibleCustomer,
        ),
      );
    } finally {
      await cleanupLocalMailVerificationFixtures(connection5b.db);
      await connection5b.dispose();
      process.env.CRM_ALLOW_TEST_DB_BIND = "1";
      bindTestDatabase(db);
      delete process.env[OPT_IN_5B];
    }
  });

  it("confirms Staff A CRM access to Customer A", async () => {
    await setupLocalMailCrmVerificationFixtures(db);
    const access = await verifyLocalMailCrmCustomerAccess(db);
    assert.equal(access.staffAMatchesCustomerA, true);
  });

  it("denies Staff B CRM access to Customer A", async () => {
    await setupLocalMailCrmVerificationFixtures(db);
    const access = await verifyLocalMailCrmCustomerAccess(db);
    assert.equal(access.staffBDeniedCustomerA, true);
  });

  it("denies Staff A Public Pool identity through lookup", async () => {
    await setupLocalMailCrmVerificationFixtures(db);
    const access = await verifyLocalMailCrmCustomerAccess(db);
    assert.equal(access.staffADeniedPublicPool, true);
  });

  it("stores outbound manual association on revision", async () => {
    await setupLocalMailCrmVerificationFixtures(db);
    const [revision] = await db
      .select({
        customerId: schema.mailOutboundRevisions.customerId,
        customerAssociationType:
          schema.mailOutboundRevisions.customerAssociationType,
      })
      .from(schema.mailOutboundRevisions)
      .where(
        eq(
          schema.mailOutboundRevisions.id,
          `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-REVISION-OUTBOUND`,
        ),
      )
      .limit(1);
    assert.ok(revision);
    assert.equal(revision.customerId, LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS.outboundManual);
    assert.equal(revision.customerAssociationType, "manual");
  });

  it("keeps no-match sender free of CRM contact collisions", async () => {
    await assertFixtureAddressesDoNotCollideWithCrmContacts(db, [
      LOCAL_MAIL_CRM_VERIFY_ADDRESSES.externalNoMatchEmail,
    ]);
  });

  it("passes API security expectations for Staff A/B/Admin", async () => {
    await setupLocalMailCrmVerificationFixtures(db);
    const api = await verifyLocalMailCrmVerificationApiSecurity(db);
    const accessible = api.find((row) => row.messageKey === "accessibleCustomer");
    const publicPool = api.find((row) => row.messageKey === "publicPoolCustomer");
    const outbound = api.find((row) => row.messageKey === "outboundManual");
    assert.ok(accessible);
    assert.equal(accessible.staffAAssociation, true);
    assert.equal(accessible.staffBAssociation, false);
    assert.equal(accessible.associationType, "auto_match");
    assert.ok(publicPool);
    assert.equal(publicPool.staffAAssociation, false);
    assert.equal(publicPool.staffBAssociation, false);
    assert.ok(outbound);
    assert.equal(outbound.staffAAssociation, true);
    assert.equal(outbound.staffBAssociation, false);
    assert.equal(outbound.associationType, "manual");
  });
});

describe("local mail CRM verification fixture 5B address isolation", () => {
  it("uses addresses disjoint from the 5B fixture namespace", () => {
    const crmAddresses = Object.values(LOCAL_MAIL_CRM_VERIFY_ADDRESSES);
    const verifyAddresses = new Set<string>(Object.values(LOCAL_MAIL_VERIFY_ADDRESSES));
    for (const address of crmAddresses) {
      assert.ok(
        !verifyAddresses.has(address),
        `CRM fixture address overlaps 5B: ${address}`,
      );
    }
  });
});
