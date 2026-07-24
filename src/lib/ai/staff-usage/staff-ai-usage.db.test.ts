import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  completeStaffAiUsage,
  expireStalePendingForUser,
  failStaffAiUsage,
  getHongKongUsageDate,
  getStaffAiUsageSummary,
  getStaffSucceededUsageCount,
  reserveStaffAiUsage,
  STAFF_AI_PENDING_TTL_MS,
  StaffAiQuotaError,
} from "@/lib/ai/staff-usage/service";
import { getAdminStaffAiUsageStats } from "@/lib/ai/staff-usage/admin-stats";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";

let db: ReturnType<typeof drizzle<typeof schema>>;
let staffUser: User;
let disposeProxy: (() => Promise<void>) | undefined;

function settings(
  overrides: Partial<EffectiveAiSettings> = {},
): EffectiveAiSettings {
  return {
    aiEnabled: true,
    aiProvider: "google_gemini",
    aiApiBaseUrl: "https://generativelanguage.googleapis.com",
    aiApiBaseUrlValid: true,
    aiModel: "gemini-2.0-flash",
    aiTemperature: 0.2,
    aiMaxTokens: 1200,
    aiTimeoutMs: 30000,
    aiAnalysisLanguage: "zh-Hant",
    aiPromptTemplate: "template",
    aiPromptVersion: "v1",
    aiShowDraftMessage: true,
    aiStaffManualRefreshEnabled: true,
    aiAdminOnlyManualRefresh: false,
    aiStaffDeepAnalysisEnabled: true,
    aiStaffDailyLimit: 2,
    ...overrides,
  };
}

async function clearUsage(userId: string) {
  await db
    .delete(schema.aiUsageEvents)
    .where(eq(schema.aiUsageEvents.userId, userId));
  await db
    .delete(schema.aiStaffDailyQuota)
    .where(eq(schema.aiStaffDailyQuota.userId, userId));
}

describe("staff AI usage quota (D1)", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;

    const [staff] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.staffA))
      .limit(1);
    assert.ok(staff);
    staffUser = staff;
    await clearUsage(staffUser.id);
  });

  after(async () => {
    await clearUsage(staffUser.id);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("reserves, completes, and counts succeeded usage", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z"); // HKT 12:00
    const usageDate = getHongKongUsageDate(now);
    const reservation = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: settings(),
      reservationKey: `test-success-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });
    assert.equal(reservation.usageDate, usageDate);
    assert.equal(reservation.reused, false);

    await completeStaffAiUsage(
      db,
      { ...reservation, userId: staffUser.id },
      now,
    );

    assert.equal(
      await getStaffSucceededUsageCount(db, staffUser.id, usageDate),
      1,
    );
    const summary = await getStaffAiUsageSummary(
      db,
      staffUser,
      settings(),
      now,
    );
    assert.equal(summary.used, 1);
    assert.equal(summary.remaining, 1);
  });

  it("does not count provider failure as succeeded usage", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z");
    const reservation = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: settings(),
      reservationKey: `test-fail-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });
    await failStaffAiUsage(db, { ...reservation, userId: staffUser.id }, now);
    assert.equal(
      await getStaffSucceededUsageCount(
        db,
        staffUser.id,
        getHongKongUsageDate(now),
      ),
      0,
    );
  });

  it("rejects when staff deep analysis disabled", async () => {
    await clearUsage(staffUser.id);
    await assert.rejects(
      () =>
        reserveStaffAiUsage(db, {
          user: staffUser,
          settings: settings({ aiStaffDeepAnalysisEnabled: false }),
          reservationKey: `test-disabled-${crypto.randomUUID()}`,
          customerId: SEED_IDS.customerStaffA,
          providerKind: "google_gemini",
        }),
      (error: unknown) =>
        error instanceof StaffAiQuotaError &&
        error.code === "AI_STAFF_DEEP_ANALYSIS_DISABLED",
    );
  });

  it("rejects when daily limit reached and enforces concurrency", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z");
    const cfg = settings({ aiStaffDailyLimit: 1 });

    await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: cfg,
      reservationKey: `test-limit-pending-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });

    await assert.rejects(
      () =>
        reserveStaffAiUsage(db, {
          user: staffUser,
          settings: cfg,
          reservationKey: `test-limit-pending-b-${crypto.randomUUID()}`,
          customerId: SEED_IDS.customerStaffA,
          providerKind: "google_gemini",
          now,
        }),
      (error: unknown) =>
        error instanceof StaffAiQuotaError &&
        error.code === "AI_STAFF_DAILY_LIMIT_REACHED",
    );

    await clearUsage(staffUser.id);
    const first = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: cfg,
      reservationKey: `test-limit-a-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });
    await completeStaffAiUsage(
      db,
      { ...first, userId: staffUser.id },
      now,
    );

    await assert.rejects(
      () =>
        reserveStaffAiUsage(db, {
          user: staffUser,
          settings: cfg,
          reservationKey: `test-limit-b-${crypto.randomUUID()}`,
          customerId: SEED_IDS.customerStaffA,
          providerKind: "google_gemini",
          now,
        }),
      (error: unknown) =>
        error instanceof StaffAiQuotaError &&
        error.code === "AI_STAFF_DAILY_LIMIT_REACHED",
    );
  });

  it("reuses the same reservation key without double counting", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z");
    const key = `test-idem-${crypto.randomUUID()}`;
    const first = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: settings({ aiStaffDailyLimit: 1 }),
      reservationKey: key,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });
    await completeStaffAiUsage(db, { ...first, userId: staffUser.id }, now);

    const second = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: settings({ aiStaffDailyLimit: 1 }),
      reservationKey: key,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });
    assert.equal(second.reused, true);
    await completeStaffAiUsage(db, { ...second, userId: staffUser.id }, now);

    assert.equal(
      await getStaffSucceededUsageCount(
        db,
        staffUser.id,
        getHongKongUsageDate(now),
      ),
      1,
    );
  });

  it("releases expired pending reservations", async () => {
    await clearUsage(staffUser.id);
    const createdAt = new Date("2026-07-20T01:00:00.000Z");
    const later = new Date(
      createdAt.getTime() + STAFF_AI_PENDING_TTL_MS + 60_000,
    );
    const cfg = settings({ aiStaffDailyLimit: 1 });

    await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: cfg,
      reservationKey: `test-expire-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now: createdAt,
    });

    const next = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: cfg,
      reservationKey: `test-expire-next-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now: later,
    });
    assert.equal(next.reused, false);
  });

  it("aggregates admin stats for succeeded staff usage only", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z");
    const cfg = settings({ aiStaffDailyLimit: 5 });
    const reservation = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: cfg,
      reservationKey: `test-stats-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });
    await completeStaffAiUsage(
      db,
      { ...reservation, userId: staffUser.id },
      now,
    );

    const stats = await getAdminStaffAiUsageStats(db, cfg, now);
    assert.equal(stats.usageDate, getHongKongUsageDate(now));
    assert.ok(stats.todaySuccessTotal >= 1);
    assert.ok(stats.todayActiveStaffCount >= 1);
    const row = stats.staff.find((item) => item.userId === staffUser.id);
    assert.ok(row);
    assert.equal(row.used, 1);
    assert.equal(row.remaining, 4);

    const lowered = await getAdminStaffAiUsageStats(
      db,
      settings({ aiStaffDailyLimit: 1 }),
      now,
    );
    const loweredRow = lowered.staff.find(
      (item) => item.userId === staffUser.id,
    );
    assert.ok(loweredRow);
    assert.equal(loweredRow.remaining, 0);
  });

  it("keeps usage rows when settings switch is turned off", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z");
    const reservation = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: settings(),
      reservationKey: `test-keep-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });
    await completeStaffAiUsage(
      db,
      { ...reservation, userId: staffUser.id },
      now,
    );

    const usageDate = getHongKongUsageDate(now);
    const before = await getStaffSucceededUsageCount(
      db,
      staffUser.id,
      usageDate,
    );
    assert.equal(before, 1);

    const summary = await getStaffAiUsageSummary(
      db,
      staffUser,
      settings({ aiStaffDeepAnalysisEnabled: false }),
      now,
    );
    assert.equal(summary.used, 1);
    assert.equal(summary.enabled, false);

    const [event] = await db
      .select()
      .from(schema.aiUsageEvents)
      .where(
        and(
          eq(schema.aiUsageEvents.userId, staffUser.id),
          eq(schema.aiUsageEvents.usageDate, usageDate),
        ),
      )
      .limit(1);
    assert.ok(event);
    assert.equal(event.status, "succeeded");
  });

  it("rejects complete-after-fail and fail-after-complete via conditional updates", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z");
    const failed = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: settings({ aiStaffDailyLimit: 3 }),
      reservationKey: `test-fail-then-complete-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });
    await failStaffAiUsage(db, { ...failed, userId: staffUser.id }, now);
    await completeStaffAiUsage(db, { ...failed, userId: staffUser.id }, now);
    assert.equal(
      await getStaffSucceededUsageCount(
        db,
        staffUser.id,
        getHongKongUsageDate(now),
      ),
      0,
    );

    const succeeded = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: settings({ aiStaffDailyLimit: 3 }),
      reservationKey: `test-complete-then-fail-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });
    await completeStaffAiUsage(db, { ...succeeded, userId: staffUser.id }, now);
    const reservedBeforeFail = (
      await db
        .select()
        .from(schema.aiStaffDailyQuota)
        .where(eq(schema.aiStaffDailyQuota.userId, staffUser.id))
        .limit(1)
    )[0]?.reservedCount;
    await failStaffAiUsage(db, { ...succeeded, userId: staffUser.id }, now);
    const reservedAfterFail = (
      await db
        .select()
        .from(schema.aiStaffDailyQuota)
        .where(eq(schema.aiStaffDailyQuota.userId, staffUser.id))
        .limit(1)
    )[0]?.reservedCount;
    assert.equal(reservedAfterFail, reservedBeforeFail);
    assert.equal(
      await getStaffSucceededUsageCount(
        db,
        staffUser.id,
        getHongKongUsageDate(now),
      ),
      1,
    );
  });

  it("rejects reusing a failed reservation key", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z");
    const key = `test-failed-key-${crypto.randomUUID()}`;
    const reservation = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: settings(),
      reservationKey: key,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now,
    });
    await failStaffAiUsage(db, { ...reservation, userId: staffUser.id }, now);
    await assert.rejects(
      () =>
        reserveStaffAiUsage(db, {
          user: staffUser,
          settings: settings(),
          reservationKey: key,
          customerId: SEED_IDS.customerStaffA,
          providerKind: "google_gemini",
          now,
        }),
      (error: unknown) =>
        error instanceof StaffAiQuotaError &&
        error.code === "AI_STAFF_RESERVATION_CONFLICT",
    );
  });

  it("releases reserved slots exactly once under concurrent expiry", async () => {
    await clearUsage(staffUser.id);
    const createdAt = new Date("2026-07-20T01:00:00.000Z");
    const later = new Date(
      createdAt.getTime() + STAFF_AI_PENDING_TTL_MS + 60_000,
    );
    const cfg = settings({ aiStaffDailyLimit: 1 });
    await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: cfg,
      reservationKey: `test-concurrent-expire-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now: createdAt,
    });

    const usageDate = getHongKongUsageDate(createdAt);
    const [firstRelease, secondRelease] = await Promise.all([
      expireStalePendingForUser(db, staffUser.id, usageDate, later),
      expireStalePendingForUser(db, staffUser.id, usageDate, later),
    ]);
    assert.equal(firstRelease + secondRelease, 1);

    const [quota] = await db
      .select()
      .from(schema.aiStaffDailyQuota)
      .where(
        and(
          eq(schema.aiStaffDailyQuota.userId, staffUser.id),
          eq(schema.aiStaffDailyQuota.usageDate, usageDate),
        ),
      )
      .limit(1);
    assert.ok(quota);
    assert.equal(quota.reservedCount, 0);
    assert.ok(quota.reservedCount >= 0);

    const next = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: cfg,
      reservationKey: `test-after-expire-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      now: later,
    });
    assert.equal(next.reused, false);
  });

  it("allows orphan customer_id so purge is not blocked by usage events", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z");
    const orphanCustomerId = "99999999-9999-9999-9999-999999999999";
    const reservation = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: settings(),
      reservationKey: `test-orphan-customer-${crypto.randomUUID()}`,
      customerId: orphanCustomerId,
      providerKind: "google_gemini",
      now,
    });
    await completeStaffAiUsage(
      db,
      { ...reservation, userId: staffUser.id },
      now,
    );
    const [event] = await db
      .select()
      .from(schema.aiUsageEvents)
      .where(eq(schema.aiUsageEvents.id, reservation.eventId))
      .limit(1);
    assert.equal(event?.customerId, orphanCustomerId);
  });

  it("shares daily limit across deep_analysis_refresh and follow_up_organization", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z");
    const cfg = settings({ aiStaffDailyLimit: 1 });
    const deep = await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: cfg,
      reservationKey: `test-deep-${crypto.randomUUID()}`,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      operationType: "deep_analysis_refresh",
      now,
    });
    await completeStaffAiUsage(db, { ...deep, userId: staffUser.id }, now);

    await assert.rejects(
      () =>
        reserveStaffAiUsage(db, {
          user: staffUser,
          settings: cfg,
          reservationKey: `test-organize-${crypto.randomUUID()}`,
          customerId: SEED_IDS.customerStaffA,
          providerKind: "google_gemini",
          operationType: "follow_up_organization",
          now,
        }),
      (error: unknown) =>
        error instanceof StaffAiQuotaError &&
        error.code === "AI_STAFF_DAILY_LIMIT_REACHED",
    );

    const [event] = await db
      .select()
      .from(schema.aiUsageEvents)
      .where(eq(schema.aiUsageEvents.id, deep.eventId))
      .limit(1);
    assert.equal(event?.operationType, "deep_analysis_refresh");
  });

  it("rejects reservation key reuse across operation or customer scope", async () => {
    await clearUsage(staffUser.id);
    const now = new Date("2026-07-20T04:00:00.000Z");
    const key = `test-scope-bind-${crypto.randomUUID()}`;
    await reserveStaffAiUsage(db, {
      user: staffUser,
      settings: settings(),
      reservationKey: key,
      customerId: SEED_IDS.customerStaffA,
      providerKind: "google_gemini",
      operationType: "deep_analysis_refresh",
      now,
    });

    await assert.rejects(
      () =>
        reserveStaffAiUsage(db, {
          user: staffUser,
          settings: settings(),
          reservationKey: key,
          customerId: SEED_IDS.customerStaffA,
          providerKind: "google_gemini",
          operationType: "follow_up_organization",
          now,
        }),
      (error: unknown) =>
        error instanceof StaffAiQuotaError &&
        error.code === "AI_STAFF_RESERVATION_CONFLICT",
    );

    await assert.rejects(
      () =>
        reserveStaffAiUsage(db, {
          user: staffUser,
          settings: settings(),
          reservationKey: key,
          customerId: null,
          providerKind: "google_gemini",
          operationType: "deep_analysis_refresh",
          now,
        }),
      (error: unknown) =>
        error instanceof StaffAiQuotaError &&
        error.code === "AI_STAFF_RESERVATION_CONFLICT",
    );
  });
});
