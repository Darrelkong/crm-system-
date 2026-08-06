import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getDashboardTrends } from "./dashboard-trends";
import { selectTrendWindow } from "./dashboard-trends-period";
import type { User } from "../../../drizzle/schema/users";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const staffA = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff A",
} as User;

const staffB = {
  id: SEED_IDS.staffB,
  role: "staff",
  displayName: "Staff B",
} as User;

const admin = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

const FIXED_NOW = new Date("2026-08-06T04:00:00.000Z");
const CUST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb701";
const FU_A = "cccccccc-cccc-cccc-cccc-ccccccccc701";
const FU_B = "cccccccc-cccc-cccc-cccc-ccccccccc702";
const FU_SYS = "cccccccc-cccc-cccc-cccc-ccccccccc703";

async function cleanup(): Promise<void> {
  await db.delete(schema.followUps).where(eq(schema.followUps.customerId, CUST));
  await db
    .delete(schema.fieldChangeLogs)
    .where(eq(schema.fieldChangeLogs.customerId, CUST));
  await db
    .delete(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, CUST));
  await db.delete(schema.customers).where(eq(schema.customers.id, CUST));
}

describe("dashboard trends permissions and accuracy DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("scopes staff valid follow-ups to the actor and excludes invalid rows", async () => {
    await cleanup();
    const nowIso = FIXED_NOW.toISOString();
    await db.insert(schema.customers).values({
      id: CUST,
      customerName: "[TEST] Trends customer",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+86",
      phone: "13700000701",
      source: "referral",
      salesStage: "negotiation",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.staffA,
      updatedBy: SEED_IDS.staffA,
      isPinned: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await db.insert(schema.followUps).values({
      id: FU_A,
      customerId: CUST,
      userId: SEED_IDS.staffA,
      followUpTime: nowIso,
      channel: "phone",
      outcome: "contact_made",
      summary: "valid a",
      content: "valid a",
      isValidFollowUp: 1,
      createdAt: nowIso,
    });
    await db.insert(schema.followUps).values({
      id: FU_B,
      customerId: CUST,
      userId: SEED_IDS.staffB,
      followUpTime: nowIso,
      channel: "phone",
      outcome: "contact_made",
      summary: "valid b",
      content: "valid b",
      isValidFollowUp: 1,
      createdAt: nowIso,
    });
    await db.insert(schema.followUps).values({
      id: FU_SYS,
      customerId: CUST,
      userId: SEED_IDS.staffA,
      followUpTime: nowIso,
      channel: "other",
      outcome: "no_answer",
      summary: "invalid",
      content: "invalid",
      isValidFollowUp: 0,
      createdAt: nowIso,
    });

    const staffTrends = await getDashboardTrends(db, staffA, FIXED_NOW);
    assert.equal(staffTrends.role, "staff");
    assert.equal(staffTrends.defaultMetricKey, "valid_follow_ups");
    assert.equal(
      staffTrends.availableMetrics.some((m) => m.key === "entered_negotiation"),
      false,
    );
    const staffWindow = selectTrendWindow(
      staffTrends.dailySeries.valid_follow_ups!,
      7,
    );
    assert.equal(staffWindow.current.length, 7);
    assert.equal(staffWindow.comparison.currentTotal, 1);

    const otherStaff = await getDashboardTrends(db, staffB, FIXED_NOW);
    const otherWindow = selectTrendWindow(
      otherStaff.dailySeries.valid_follow_ups!,
      7,
    );
    assert.equal(otherWindow.comparison.currentTotal, 1);

    const adminTrends = await getDashboardTrends(db, admin, FIXED_NOW);
    assert.equal(adminTrends.role, "admin");
    assert.equal(adminTrends.defaultMetricKey, "new_customers");
    const adminFollowUps = selectTrendWindow(
      adminTrends.dailySeries.valid_follow_ups!,
      7,
    );
    assert.ok(adminFollowUps.comparison.currentTotal >= 2);
    assert.ok(adminTrends.dailySeries.entered_negotiation);
    assert.ok(adminTrends.dailySeries.closed_won);
    assert.ok(adminTrends.unavailableMetricKeys.includes("pending_second_conversion"));
  });

  it("counts negotiation entries from field change logs for admin only", async () => {
    await cleanup();
    const nowIso = FIXED_NOW.toISOString();
    await db.insert(schema.customers).values({
      id: CUST,
      customerName: "[TEST] Trends negotiation",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+86",
      phone: "13700000702",
      source: "referral",
      salesStage: "negotiation",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.staffA,
      updatedBy: SEED_IDS.admin,
      isPinned: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await db.insert(schema.fieldChangeLogs).values({
      id: "ffffffff-ffff-ffff-ffff-fffffffffff701",
      customerId: CUST,
      fieldName: "sales_stage",
      oldValue: "contacted",
      newValue: "negotiation",
      changedBy: SEED_IDS.admin,
      changedAt: nowIso,
    });

    const adminTrends = await getDashboardTrends(db, admin, FIXED_NOW);
    const window = selectTrendWindow(
      adminTrends.dailySeries.entered_negotiation!,
      7,
    );
    assert.ok(window.comparison.currentTotal >= 1);

    const staffTrends = await getDashboardTrends(db, staffA, FIXED_NOW);
    assert.equal(staffTrends.dailySeries.entered_negotiation, undefined);
  });
});
