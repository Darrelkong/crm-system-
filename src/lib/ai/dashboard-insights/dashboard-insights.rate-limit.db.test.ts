import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  clearDashboardAiRateLimitEventsForTests,
  reserveDashboardAiProviderRefresh,
} from "./rate-limit";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

describe("dashboard AI D1 rate limit", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await clearDashboardAiRateLimitEventsForTests(db, SEED_IDS.staffA);
    await clearDashboardAiRateLimitEventsForTests(db, SEED_IDS.staffB);
    await clearDashboardAiRateLimitEventsForTests(db, SEED_IDS.admin);
  });

  after(async () => {
    await clearDashboardAiRateLimitEventsForTests(db, SEED_IDS.staffA);
    await clearDashboardAiRateLimitEventsForTests(db, SEED_IDS.staffB);
    await clearDashboardAiRateLimitEventsForTests(db, SEED_IDS.admin);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("allows the first force-refresh reservation per user and insight type", async () => {
    const now = new Date("2026-08-07T04:00:00.000Z");
    const first = await reserveDashboardAiProviderRefresh(db, {
      userId: SEED_IDS.staffA,
      insightType: "staff_today_actions",
      now,
    });
    assert.equal(first.allowed, true);
  });

  it("rate limits a second force-refresh in the same 60s window", async () => {
    const now = new Date("2026-08-07T04:00:10.000Z");
    const second = await reserveDashboardAiProviderRefresh(db, {
      userId: SEED_IDS.staffA,
      insightType: "staff_today_actions",
      now,
    });
    assert.equal(second.allowed, false);
    if (second.allowed) throw new Error("expected rate limit");
    assert.ok(second.retryAfterMs > 0);
  });

  it("isolates staff users", async () => {
    const now = new Date("2026-08-07T04:00:15.000Z");
    const staffB = await reserveDashboardAiProviderRefresh(db, {
      userId: SEED_IDS.staffB,
      insightType: "staff_today_actions",
      now,
    });
    assert.equal(staffB.allowed, true);
  });

  it("isolates admin and staff", async () => {
    const now = new Date("2026-08-07T04:00:20.000Z");
    const admin = await reserveDashboardAiProviderRefresh(db, {
      userId: SEED_IDS.admin,
      insightType: "admin_management_brief",
      now,
    });
    assert.equal(admin.allowed, true);
  });

  it("isolates insight types for the same user", async () => {
    const now = new Date("2026-08-07T04:00:25.000Z");
    await clearDashboardAiRateLimitEventsForTests(db, SEED_IDS.staffB);
    const staffTypeA = await reserveDashboardAiProviderRefresh(db, {
      userId: SEED_IDS.staffB,
      insightType: "staff_today_actions",
      now,
    });
    assert.equal(staffTypeA.allowed, true);

    const staffTypeB = await reserveDashboardAiProviderRefresh(db, {
      userId: SEED_IDS.staffB,
      insightType: "admin_management_brief",
      now: new Date(now.getTime() + 1_000),
    });
    assert.equal(staffTypeB.allowed, true);
  });

  it("allows only one concurrent reservation for the same window", async () => {
    await clearDashboardAiRateLimitEventsForTests(db, SEED_IDS.admin);
    const now = new Date("2026-08-07T05:00:00.000Z");
    const [first, second] = await Promise.all([
      reserveDashboardAiProviderRefresh(db, {
        userId: SEED_IDS.admin,
        insightType: "admin_management_brief",
        now,
      }),
      reserveDashboardAiProviderRefresh(db, {
        userId: SEED_IDS.admin,
        insightType: "admin_management_brief",
        now,
      }),
    ]);
    const allowedCount = [first, second].filter((result) => result.allowed).length;
    assert.equal(allowedCount, 1);
  });

  it("does not expose reservation keys to callers", async () => {
    const now = new Date("2026-08-07T05:00:05.000Z");
    const result = await reserveDashboardAiProviderRefresh(db, {
      userId: SEED_IDS.admin,
      insightType: "admin_management_brief",
      now,
    });
    assert.equal("reservationKey" in result, false);
    if (result.allowed) {
      const row = await db
        .select({ reservationKey: schema.aiUsageEvents.reservationKey })
        .from(schema.aiUsageEvents)
        .where(eq(schema.aiUsageEvents.id, result.eventId))
        .limit(1);
      assert.match(row[0]?.reservationKey ?? "", /^dashboard-ai:/);
    }
  });
});
