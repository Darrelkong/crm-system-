import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getDashboardSummary } from "./dashboard-summary";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import { getBusinessTodayRange } from "./dates";
import type { User } from "../../../drizzle/schema/users";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const adminUser = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

const staffUser = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff A",
} as User;

const IDS = {
  stillInPool: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa901",
  claimedToday: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa902",
  enteredYesterday: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa903",
  secondToday: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa904",
};

const FIXED_NOW = new Date("2026-08-06T04:00:00.000Z");

function makeCustomer(
  id: string,
  overrides: Partial<typeof schema.customers.$inferInsert>,
) {
  const now = FIXED_NOW.toISOString();
  return {
    id,
    customerName: `[TEST] pool entered ${id.slice(-3)}`,
    nameStatus: "confirmed" as const,
    customerType: "individual" as const,
    phoneCountryCode: "+86",
    phone: `13900000${id.slice(-3)}`,
    source: "referral",
    salesStage: "negotiation" as const,
    ownerId: null,
    status: "public_pool" as const,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    isPinned: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  for (const id of Object.values(IDS)) {
    await db.delete(schema.customers).where(eq(schema.customers.id, id));
  }
}

describe("dashboard public pool entered today DB", () => {
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

  it("counts today entries including claimed customers and excludes yesterday", async () => {
    await cleanup();
    const { start, end } = getBusinessTodayRange(FIXED_NOW, HONG_KONG_TIMEZONE);
    const todayMid = new Date(
      (new Date(start).getTime() + new Date(end).getTime()) / 2,
    ).toISOString();
    const yesterday = new Date(
      new Date(start).getTime() - 60 * 60 * 1000,
    ).toISOString();

    await db.insert(schema.customers).values([
      makeCustomer(IDS.stillInPool, {
        status: "public_pool",
        poolEnteredAt: todayMid,
      }),
      makeCustomer(IDS.claimedToday, {
        status: "active",
        ownerId: SEED_IDS.staffA,
        poolEnteredAt: todayMid,
        claimedBy: SEED_IDS.staffA,
        claimedAt: FIXED_NOW.toISOString(),
        poolLeftAt: FIXED_NOW.toISOString(),
      }),
      makeCustomer(IDS.enteredYesterday, {
        status: "public_pool",
        poolEnteredAt: yesterday,
      }),
      makeCustomer(IDS.secondToday, {
        status: "public_pool",
        poolEnteredAt: todayMid,
      }),
    ]);

    const summary = await getDashboardSummary(db, adminUser, FIXED_NOW);
    assert.equal(summary.role, "admin");
    assert.equal(summary.metrics.publicPoolEnteredToday, 3);

    const staff = await getDashboardSummary(db, staffUser, FIXED_NOW);
    assert.equal(staff.role, "staff");
    assert.equal(
      "publicPoolEnteredToday" in staff.metrics,
      false,
    );
  });
});
