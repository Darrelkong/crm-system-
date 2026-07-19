import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { buildInsertPrimaryAssigneeStatement } from "./primary-assignee";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Local, test-only customer IDs so we never touch seeded fixtures.
const CUSTOMER_STAFF_CREATE = "aaaaaaaa-0000-0000-0000-000000000001";
const CUSTOMER_ADMIN_CREATE = "aaaaaaaa-0000-0000-0000-000000000002";
const CUSTOMER_IMPORT_CREATE = "aaaaaaaa-0000-0000-0000-000000000003";
const CUSTOMER_ATOMIC_ROLLBACK = "aaaaaaaa-0000-0000-0000-000000000004";

const ALL_TEST_CUSTOMER_IDS = [
  CUSTOMER_STAFF_CREATE,
  CUSTOMER_ADMIN_CREATE,
  CUSTOMER_IMPORT_CREATE,
  CUSTOMER_ATOMIC_ROLLBACK,
];

function buildInsertCustomerStatement(
  db: Db,
  input: { id: string; ownerId: string; createdBy: string; now: string },
) {
  return db.insert(schema.customers).values({
    id: input.id,
    customerCode: `TEST-${input.id.slice(-4)}`,
    customerName: "测试客户",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: null,
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    status: "active",
    ownerId: input.ownerId,
    createdBy: input.createdBy,
    updatedBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function cleanup(db: Db) {
  await db
    .delete(schema.customerAssignees)
    .where(inArray(schema.customerAssignees.customerId, ALL_TEST_CUSTOMER_IDS));
  await db
    .delete(schema.customers)
    .where(inArray(schema.customers.id, ALL_TEST_CUSTOMER_IDS));
}

async function primaryRowsFor(db: Db, customerId: string) {
  return db
    .select()
    .from(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, customerId),
        eq(schema.customerAssignees.role, "primary"),
      ),
    );
}

describe("buildInsertPrimaryAssigneeStatement (atomic owner ⇔ primary)", () => {
  let db: Db;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await cleanup(db);
  });

  after(async () => {
    await cleanup(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("staff create: primary assignee mirrors owner (self) in same batch", async () => {
    const now = "2026-07-19T13:00:00.000Z";
    // Staff owner is always the current staff user.
    await db.batch([
      buildInsertCustomerStatement(db, {
        id: CUSTOMER_STAFF_CREATE,
        ownerId: SEED_IDS.staffA,
        createdBy: SEED_IDS.staffA,
        now,
      }),
      buildInsertPrimaryAssigneeStatement(db, {
        customerId: CUSTOMER_STAFF_CREATE,
        ownerId: SEED_IDS.staffA,
        assignedBy: SEED_IDS.staffA,
        now,
      }),
    ] as unknown as Parameters<typeof db.batch>[0]);

    const rows = await primaryRowsFor(db, CUSTOMER_STAFF_CREATE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.userId, SEED_IDS.staffA);
    assert.equal(rows[0]?.role, "primary");
    assert.equal(rows[0]?.assignedBy, SEED_IDS.staffA);
    assert.equal(rows[0]?.assignedAt, now);
    assert.equal(rows[0]?.createdAt, now);
    assert.equal(rows[0]?.updatedAt, now);
  });

  it("admin create: primary mirrors resolved owner, assignedBy is acting admin", async () => {
    const now = "2026-07-19T13:05:00.000Z";
    // Admin resolves owner to another user (e.g. body.ownerId = staffB).
    await db.batch([
      buildInsertCustomerStatement(db, {
        id: CUSTOMER_ADMIN_CREATE,
        ownerId: SEED_IDS.staffB,
        createdBy: SEED_IDS.admin,
        now,
      }),
      buildInsertPrimaryAssigneeStatement(db, {
        customerId: CUSTOMER_ADMIN_CREATE,
        ownerId: SEED_IDS.staffB,
        assignedBy: SEED_IDS.admin,
        now,
      }),
    ] as unknown as Parameters<typeof db.batch>[0]);

    const rows = await primaryRowsFor(db, CUSTOMER_ADMIN_CREATE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.userId, SEED_IDS.staffB);
    assert.equal(rows[0]?.assignedBy, SEED_IDS.admin);
    assert.equal(rows[0]?.role, "primary");
  });

  it("import create: primary mirrors importing user", async () => {
    const now = "2026-07-19T13:10:00.000Z";
    await db.batch([
      buildInsertCustomerStatement(db, {
        id: CUSTOMER_IMPORT_CREATE,
        ownerId: SEED_IDS.staffA,
        createdBy: SEED_IDS.staffA,
        now,
      }),
      buildInsertPrimaryAssigneeStatement(db, {
        customerId: CUSTOMER_IMPORT_CREATE,
        ownerId: SEED_IDS.staffA,
        assignedBy: SEED_IDS.staffA,
        now,
      }),
    ] as unknown as Parameters<typeof db.batch>[0]);

    const rows = await primaryRowsFor(db, CUSTOMER_IMPORT_CREATE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.userId, SEED_IDS.staffA);
    assert.equal(rows[0]?.role, "primary");
  });

  it("atomicity: if customer insert fails, no orphan primary row is written", async () => {
    const now = "2026-07-19T13:15:00.000Z";
    // Pre-insert a customer to force a primary-key conflict on the batch below.
    await buildInsertCustomerStatement(db, {
      id: CUSTOMER_ATOMIC_ROLLBACK,
      ownerId: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      now,
    });

    await assert.rejects(async () => {
      await db.batch([
        buildInsertCustomerStatement(db, {
          id: CUSTOMER_ATOMIC_ROLLBACK,
          ownerId: SEED_IDS.staffA,
          createdBy: SEED_IDS.staffA,
          now,
        }),
        buildInsertPrimaryAssigneeStatement(db, {
          customerId: CUSTOMER_ATOMIC_ROLLBACK,
          ownerId: SEED_IDS.staffA,
          assignedBy: SEED_IDS.staffA,
          now,
        }),
      ] as unknown as Parameters<typeof db.batch>[0]);
    });

    const rows = await primaryRowsFor(db, CUSTOMER_ATOMIC_ROLLBACK);
    assert.equal(rows.length, 0);
  });
});
