import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getRecycleBinRetentionCutoffIso } from "@/lib/recycle-bin/constants";
import { previewExpiredRecycleBinCustomers } from "@/lib/recycle-bin/service";

const TEST_WITHIN_90 = "d6666666-6666-6666-6666-666666666601";
const TEST_EXPIRED = "d6666666-6666-6666-6666-666666666602";
const TEST_AT_CUTOFF = "d6666666-6666-6666-6666-666666666603";
const TEST_ACTIVE = "d6666666-6666-6666-6666-666666666604";
const TEST_ARCHIVED_NO_DELETED = "d6666666-6666-6666-6666-666666666605";
const TEST_EXPIRED_B = "d6666666-6666-6666-6666-666666666606";
const TEST_EXPIRED_C = "d6666666-6666-6666-6666-666666666607";

const ALL_TEST_IDS = [
  TEST_WITHIN_90,
  TEST_EXPIRED,
  TEST_AT_CUTOFF,
  TEST_ACTIVE,
  TEST_ARCHIVED_NO_DELETED,
  TEST_EXPIRED_B,
  TEST_EXPIRED_C,
];

const FIXED_NOW = new Date("2026-06-26T12:00:00.000Z");

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: null,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000001",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    status: "archived",
    ownerId: SEED_IDS.staffA,
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    createdBy: SEED_IDS.staffA,
    updatedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
    deletedAt: "2026-03-01T12:00:00.000Z",
    deletedBy: SEED_IDS.admin,
    deletedReason: "测试删除",
    ...overrides,
  } as Customer;
}

async function upsertCustomer(customer: Customer) {
  const existing = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.id, customer.id))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.customers)
      .set(customer)
      .where(eq(schema.customers.id, customer.id));
  } else {
    await db.insert(schema.customers).values(customer);
  }
}

async function countCustomers(): Promise<number> {
  const rows = await db.select({ id: schema.customers.id }).from(schema.customers);
  return rows.length;
}

async function countPermanentDeleteAudits(): Promise<number> {
  const rows = await db
    .select({ id: schema.auditLogs.id })
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.action, "customer.deleted.permanent"));
  return rows.length;
}

async function deleteTestData() {
  for (const customerId of ALL_TEST_IDS) {
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, customerId));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, customerId));
  }
}

async function seedPreviewFixtures() {
  const cutoff = getRecycleBinRetentionCutoffIso(FIXED_NOW);
  const oneMsBeforeCutoff = new Date(new Date(cutoff).getTime() - 1).toISOString();

  await upsertCustomer(
    makeCustomer({
      id: TEST_WITHIN_90,
      customerName: "Within 90 Days",
      customerCode: "EF-WITHIN-90",
      deletedAt: "2026-06-01T12:00:00.000Z",
      deletedReason: "近期删除",
    }),
  );

  await upsertCustomer(
    makeCustomer({
      id: TEST_EXPIRED,
      customerName: "Expired Customer",
      customerCode: "EF-EXPIRED-01",
      deletedAt: "2026-03-01T12:00:00.000Z",
      deletedReason: "超期删除 A",
    }),
  );

  await upsertCustomer(
    makeCustomer({
      id: TEST_AT_CUTOFF,
      customerName: "At Cutoff Boundary",
      customerCode: "EF-AT-CUTOFF",
      deletedAt: cutoff,
      deletedReason: "边界测试",
    }),
  );

  await upsertCustomer(
    makeCustomer({
      id: TEST_ACTIVE,
      customerName: "Active Not Recycle",
      customerCode: "EF-ACTIVE",
      status: "active",
      deletedAt: "2026-03-01T12:00:00.000Z",
      deletedReason: "非 archived",
    }),
  );

  await upsertCustomer(
    makeCustomer({
      id: TEST_ARCHIVED_NO_DELETED,
      customerName: "Archived Legacy",
      customerCode: "EF-LEGACY",
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
    }),
  );

  await upsertCustomer(
    makeCustomer({
      id: TEST_EXPIRED_B,
      customerName: "Expired B",
      customerCode: "EF-EXPIRED-02",
      deletedAt: oneMsBeforeCutoff,
      deletedReason: "超期删除 B",
    }),
  );

  await upsertCustomer(
    makeCustomer({
      id: TEST_EXPIRED_C,
      customerName: "Expired C",
      customerCode: "EF-EXPIRED-03",
      deletedAt: "2026-02-01T12:00:00.000Z",
      deletedReason: "超期删除 C",
    }),
  );
}

describe("previewExpiredRecycleBinCustomers", () => {
  before(async () => {
    const proxy = await getPlatformProxy({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
  });

  after(async () => {
    await deleteTestData();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("excludes customers deleted within 90 days", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const preview = await previewExpiredRecycleBinCustomers(db, { now: FIXED_NOW });

    assert.equal(
      preview.customers.some((c) => c.id === TEST_WITHIN_90),
      false,
    );
  });

  it("includes customers deleted more than 90 days ago", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const preview = await previewExpiredRecycleBinCustomers(db, { now: FIXED_NOW });

    assert.equal(
      preview.customers.some((c) => c.id === TEST_EXPIRED),
      true,
    );
  });

  it("excludes customers with deletedAt exactly at cutoff (strict <)", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const cutoff = getRecycleBinRetentionCutoffIso(FIXED_NOW);
    const preview = await previewExpiredRecycleBinCustomers(db, { now: FIXED_NOW });

    assert.equal(preview.cutoff, cutoff);
    assert.equal(
      preview.customers.some((c) => c.id === TEST_AT_CUTOFF),
      false,
    );
  });

  it("excludes non-archived customers even with old deletedAt", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const preview = await previewExpiredRecycleBinCustomers(db, { now: FIXED_NOW });

    assert.equal(
      preview.customers.some((c) => c.id === TEST_ACTIVE),
      false,
    );
  });

  it("excludes archived customers with deletedAt null", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const preview = await previewExpiredRecycleBinCustomers(db, { now: FIXED_NOW });

    assert.equal(
      preview.customers.some((c) => c.id === TEST_ARCHIVED_NO_DELETED),
      false,
    );
  });

  it("does not modify the database", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const beforeCount = await countCustomers();
    const expiredBefore = await db
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, TEST_EXPIRED),
          eq(schema.customers.status, "archived"),
        ),
      );

    await previewExpiredRecycleBinCustomers(db, { now: FIXED_NOW });

    const afterCount = await countCustomers();
    const expiredAfter = await db
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, TEST_EXPIRED),
          eq(schema.customers.status, "archived"),
        ),
      );

    assert.equal(afterCount, beforeCount);
    assert.equal(expiredAfter.length, 1);
    assert.equal(expiredAfter[0]!.customerName, expiredBefore[0]!.customerName);
  });

  it("does not write permanent-delete audit logs", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const beforeAudits = await countPermanentDeleteAudits();

    await previewExpiredRecycleBinCustomers(db, { now: FIXED_NOW });

    const afterAudits = await countPermanentDeleteAudits();
    assert.equal(afterAudits, beforeAudits);
  });

  it("returns customerCode, deletedReason, and deletedByName", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const preview = await previewExpiredRecycleBinCustomers(db, { now: FIXED_NOW });
    const expired = preview.customers.find((c) => c.id === TEST_EXPIRED);

    assert.ok(expired);
    assert.equal(expired.customerCode, "EF-EXPIRED-01");
    assert.equal(expired.deletedReason, "超期删除 A");
    assert.equal(expired.deletedByName, "系统管理员");
    assert.ok(typeof expired.remainingRetentionDays === "number");
    assert.ok(expired.remainingRetentionDays < 0);
  });

  it("respects batch limit while reporting totalSize", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const preview = await previewExpiredRecycleBinCustomers(db, {
      now: FIXED_NOW,
      batchSize: 2,
    });

    assert.equal(preview.customers.length, 2);
    assert.equal(preview.expiredCount, 3);
  });

  it("orders customers by deletedAt ascending (oldest first)", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const preview = await previewExpiredRecycleBinCustomers(db, { now: FIXED_NOW });

    assert.equal(preview.customers.length, 3);
    const deletedAts = preview.customers.map((c) => c.deletedAt);
    const sorted = [...deletedAts].sort();
    assert.deepEqual(deletedAts, sorted);
    assert.equal(preview.customers[0]!.id, TEST_EXPIRED_C);
  });
});
