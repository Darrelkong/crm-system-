import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { AuthError } from "@/lib/permissions/auth";
import { getRecycleBinRetentionCutoffIso } from "@/lib/recycle-bin/constants";
import {
  getRecycleBinPurgePreviewForAdmin,
  parsePurgePreviewLimitParam,
  resolvePurgePreviewBatchSize,
} from "@/lib/recycle-bin/purge-preview-api";

const TEST_WITHIN_90 = "d7777777-7777-7777-7777-777777777701";
const TEST_EXPIRED = "d7777777-7777-7777-7777-777777777702";
const TEST_EXPIRED_B = "d7777777-7777-7777-7777-777777777703";
const TEST_EXPIRED_C = "d7777777-7777-7777-7777-777777777704";

const ALL_TEST_IDS = [TEST_WITHIN_90, TEST_EXPIRED, TEST_EXPIRED_B, TEST_EXPIRED_C];

const FIXED_NOW = new Date("2026-06-26T12:00:00.000Z");

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staff = { id: SEED_IDS.staffA, role: "staff" } as User;

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
      id: TEST_EXPIRED_B,
      customerName: "Expired B",
      customerCode: "EF-EXPIRED-02",
      deletedAt: "2026-02-15T12:00:00.000Z",
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

describe("purge preview limit helpers", () => {
  it("defaults invalid limit params to 50", () => {
    assert.equal(parsePurgePreviewLimitParam(null), 50);
    assert.equal(parsePurgePreviewLimitParam(""), 50);
    assert.equal(parsePurgePreviewLimitParam("abc"), 50);
    assert.equal(parsePurgePreviewLimitParam("0"), 50);
    assert.equal(parsePurgePreviewLimitParam("-1"), 50);
  });

  it("caps limit at 100", () => {
    assert.equal(parsePurgePreviewLimitParam("100"), 100);
    assert.equal(parsePurgePreviewLimitParam("150"), 100);
    assert.equal(resolvePurgePreviewBatchSize(200), 100);
  });

  it("accepts valid limit values", () => {
    assert.equal(parsePurgePreviewLimitParam("10"), 10);
    assert.equal(resolvePurgePreviewBatchSize(25), 25);
  });
});

describe("getRecycleBinPurgePreviewForAdmin", () => {
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

  it("allows admin to fetch purge preview", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const preview = await getRecycleBinPurgePreviewForAdmin(admin, db, {
      now: FIXED_NOW,
    });

    assert.equal(preview.ok, true);
    assert.equal(typeof preview.cutoff, "string");
    assert.equal(preview.expiredCount, 3);
    assert.ok(Array.isArray(preview.customers));
    assert.equal(preview.customers.length, 3);
  });

  it("rejects non-admin with 403", async () => {
    await assert.rejects(
      () => getRecycleBinPurgePreviewForAdmin(staff, db, { now: FIXED_NOW }),
      (error: unknown) =>
        error instanceof AuthError && error.status === 403,
    );
  });

  it("does not modify the database", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const beforeCount = await countCustomers();
    await getRecycleBinPurgePreviewForAdmin(admin, db, { now: FIXED_NOW });
    const afterCount = await countCustomers();

    assert.equal(afterCount, beforeCount);
  });

  it("does not write customer.deleted.permanent audit logs", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const beforeAudits = await countPermanentDeleteAudits();
    await getRecycleBinPurgePreviewForAdmin(admin, db, { now: FIXED_NOW });
    const afterAudits = await countPermanentDeleteAudits();

    assert.equal(afterAudits, beforeAudits);
  });

  it("includes expired customers and excludes within-90-day customers", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const preview = await getRecycleBinPurgePreviewForAdmin(admin, db, {
      now: FIXED_NOW,
    });

    const ids = preview.customers.map((c) => c.id);
    assert.equal(ids.includes(TEST_EXPIRED), true);
    assert.equal(ids.includes(TEST_WITHIN_90), false);
  });

  it("respects limit while keeping total expiredCount", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const preview = await getRecycleBinPurgePreviewForAdmin(admin, db, {
      now: FIXED_NOW,
      limit: 2,
    });

    assert.equal(preview.customers.length, 2);
    assert.equal(preview.expiredCount, 3);
  });

  it("returns expected response shape and customer fields", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    const cutoff = getRecycleBinRetentionCutoffIso(FIXED_NOW);
    const preview = await getRecycleBinPurgePreviewForAdmin(admin, db, {
      now: FIXED_NOW,
    });

    assert.equal(preview.ok, true);
    assert.equal(preview.cutoff, cutoff);
    assert.equal(preview.expiredCount, 3);

    const expired = preview.customers.find((c) => c.id === TEST_EXPIRED);
    assert.ok(expired);
    assert.equal(expired.customerName, "Expired Customer");
    assert.equal(expired.customerCode, "EF-EXPIRED-01");
    assert.equal(expired.deletedReason, "超期删除 A");
    assert.equal(expired.deletedByName, "系统管理员");
    assert.ok(typeof expired.deletedAt === "string");
    assert.ok(typeof expired.remainingRetentionDays === "number");
  });

  it("does not execute actual purge", async () => {
    await deleteTestData();
    await seedPreviewFixtures();

    await getRecycleBinPurgePreviewForAdmin(admin, db, { now: FIXED_NOW });

    const stillExists = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, TEST_EXPIRED),
          eq(schema.customers.status, "archived"),
        ),
      );

    assert.equal(stillExists.length, 1);
  });
});
