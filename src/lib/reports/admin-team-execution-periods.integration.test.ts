import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  getHongKongSeriesUtcBounds,
  TREND_RANGE_DAYS,
  type TrendRangeDays,
} from "./dashboard-trends-period";
import {
  loadConsolidatedStageProgressPeriodMaps,
  loadConsolidatedValidFollowUpPeriodMaps,
  type TeamPeriodBounds,
  type TeamPeriodMaps,
} from "./admin-team-execution";
import { loadLegacyTeamPeriodMaps } from "./admin-team-execution-periods-legacy";
import {
  getAdminTeamExecutionPeriodInstrumentation,
  resetAdminTeamExecutionPeriodInstrumentation,
} from "./admin-team-execution-instrumentation";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const FIXED_NOW = new Date("2026-08-08T12:00:00.000Z");
const STAFF_A = SEED_IDS.staffA;
const STAFF_B = SEED_IDS.staffB;
const TEST_CUSTOMER_A = "dddddddd-dddd-dddd-dddd-dddddddddd01";
const TEST_CUSTOMER_B = "dddddddd-dddd-dddd-dddd-dddddddddd02";
const TEST_CUSTOMER_C = "dddddddd-dddd-dddd-dddd-dddddddddd03";

const FOLLOW_UP_IDS = [
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01",
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02",
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03",
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04",
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05",
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee06",
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee07",
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee08",
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee09",
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10",
];

const STAGE_LOG_IDS = [
  "ffffffff-ffff-ffff-ffff-ffffffffff01",
  "ffffffff-ffff-ffff-ffff-ffffffffff02",
  "ffffffff-ffff-ffff-ffff-ffffffffff03",
  "ffffffff-ffff-ffff-ffff-ffffffffff04",
  "ffffffff-ffff-ffff-ffff-ffffffffff05",
  "ffffffff-ffff-ffff-ffff-ffffffffff06",
  "ffffffff-ffff-ffff-ffff-ffffffffff07",
  "ffffffff-ffff-ffff-ffff-ffffffffff08",
];

function buildPeriodBounds(now: Date): TeamPeriodBounds {
  return {
    7: getHongKongSeriesUtcBounds(now, 7),
    30: getHongKongSeriesUtcBounds(now, 30),
    90: getHongKongSeriesUtcBounds(now, 90),
  };
}

function isoBefore(iso: string, ms = 1): string {
  return new Date(new Date(iso).getTime() - ms).toISOString();
}

function isoAfter(iso: string, ms = 1): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) {
    if ((a.get(key) ?? 0) !== (b.get(key) ?? 0)) {
      return false;
    }
  }
  return true;
}

function periodMapsEqual(a: TeamPeriodMaps, b: TeamPeriodMaps): boolean {
  for (const days of TREND_RANGE_DAYS) {
    if (!mapsEqual(a[days], b[days])) {
      return false;
    }
  }
  return true;
}

async function cleanupFixture(): Promise<void> {
  await db
    .delete(schema.fieldChangeLogs)
    .where(inArray(schema.fieldChangeLogs.id, STAGE_LOG_IDS));
  await db
    .delete(schema.followUps)
    .where(inArray(schema.followUps.id, FOLLOW_UP_IDS));
  for (const id of [TEST_CUSTOMER_A, TEST_CUSTOMER_B, TEST_CUSTOMER_C]) {
    await db.delete(schema.customers).where(eq(schema.customers.id, id));
  }
}

async function insertTestCustomer(id: string): Promise<void> {
  const nowIso = FIXED_NOW.toISOString();
  await db.insert(schema.customers).values({
    id,
    customerName: `[TEST PERIOD] ${id.slice(-2)}`,
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: `1390000${id.slice(-4)}`,
    source: "referral",
    salesStage: "lead",
    ownerId: STAFF_A,
    status: "active",
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    isPinned: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

async function insertFollowUp(
  id: string,
  userId: string,
  customerId: string,
  followUpTime: string,
  isValid = 1,
): Promise<void> {
  await db.insert(schema.followUps).values({
    id,
    customerId,
    userId,
    followUpTime,
    channel: "phone",
    outcome: "connected",
    summary: "[TEST PERIOD] follow-up",
    content: "[TEST PERIOD] follow-up",
    isValidFollowUp: isValid,
    createdAt: followUpTime,
  });
}

async function insertStageChange(
  id: string,
  customerId: string,
  changedBy: string,
  changedAt: string,
  fieldName = "sales_stage",
): Promise<void> {
  await db.insert(schema.fieldChangeLogs).values({
    id,
    customerId,
    fieldName,
    oldValue: "lead",
    newValue: "qualification",
    changedBy,
    changedAt,
  });
}

async function loadNewPeriodMaps(actorIds: string[], bounds: TeamPeriodBounds) {
  const [followUps, stageProgress] = await Promise.all([
    loadConsolidatedValidFollowUpPeriodMaps(db, actorIds, bounds),
    loadConsolidatedStageProgressPeriodMaps(db, actorIds, bounds),
  ]);
  return { followUps, stageProgress };
}

describe("admin team execution period aggregates DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await cleanupFixture();
  });

  after(async () => {
    await cleanupFixture();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("records one physical load each for consolidated follow-up and stage period queries", async () => {
    await cleanupFixture();
    resetAdminTeamExecutionPeriodInstrumentation();
    const bounds = buildPeriodBounds(FIXED_NOW);
    await loadNewPeriodMaps([STAFF_A, STAFF_B], bounds);
    const instrumentation = getAdminTeamExecutionPeriodInstrumentation();
    assert.equal(instrumentation.teamFollowUpPeriodPhysicalLoads, 1);
    assert.equal(instrumentation.teamStagePeriodPhysicalLoads, 1);
  });

  it("returns empty period maps when actorIds is empty without running aggregates", async () => {
    resetAdminTeamExecutionPeriodInstrumentation();
    const bounds = buildPeriodBounds(FIXED_NOW);
    const { followUps, stageProgress } = await loadNewPeriodMaps([], bounds);
    assert.deepEqual(followUps[7].size, 0);
    assert.deepEqual(stageProgress[90].size, 0);
    const instrumentation = getAdminTeamExecutionPeriodInstrumentation();
    assert.equal(instrumentation.teamFollowUpPeriodPhysicalLoads, 0);
    assert.equal(instrumentation.teamStagePeriodPhysicalLoads, 0);
  });

  it("matches legacy follow-up and stage period maps for representative fixture", async () => {
    await cleanupFixture();
    await insertTestCustomer(TEST_CUSTOMER_A);
    await insertTestCustomer(TEST_CUSTOMER_B);
    await insertTestCustomer(TEST_CUSTOMER_C);

    const bounds = buildPeriodBounds(FIXED_NOW);
    const actorIds = [STAFF_A, STAFF_B];
    const start7 = bounds[7].startIso;
    const start30 = bounds[30].startIso;
    const start90 = bounds[90].startIso;
    const endExclusive = bounds[7].endExclusiveIso;

    await insertFollowUp(
      FOLLOW_UP_IDS[0]!,
      STAFF_A,
      TEST_CUSTOMER_A,
      start7,
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[1]!,
      STAFF_A,
      TEST_CUSTOMER_B,
      isoBefore(start7),
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[2]!,
      STAFF_B,
      TEST_CUSTOMER_C,
      isoBefore(start30),
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[3]!,
      STAFF_A,
      TEST_CUSTOMER_A,
      isoBefore(start90),
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[4]!,
      STAFF_A,
      TEST_CUSTOMER_B,
      endExclusive,
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[5]!,
      STAFF_A,
      TEST_CUSTOMER_C,
      isoBefore(endExclusive),
      0,
    );

    await insertStageChange(
      STAGE_LOG_IDS[0]!,
      TEST_CUSTOMER_A,
      STAFF_A,
      start7,
    );
    await insertStageChange(
      STAGE_LOG_IDS[1]!,
      TEST_CUSTOMER_A,
      STAFF_A,
      isoAfter(start7),
    );
    await insertStageChange(
      STAGE_LOG_IDS[2]!,
      TEST_CUSTOMER_B,
      STAFF_A,
      isoBefore(start7),
    );
    await insertStageChange(
      STAGE_LOG_IDS[3]!,
      TEST_CUSTOMER_C,
      STAFF_B,
      start30,
    );
    await insertStageChange(
      STAGE_LOG_IDS[4]!,
      TEST_CUSTOMER_A,
      STAFF_B,
      start7,
      "status",
    );
    await insertStageChange(
      STAGE_LOG_IDS[5]!,
      TEST_CUSTOMER_B,
      STAFF_A,
      isoBefore(start90),
    );
    await insertStageChange(
      STAGE_LOG_IDS[6]!,
      TEST_CUSTOMER_C,
      STAFF_A,
      endExclusive,
    );

    const legacy = await loadLegacyTeamPeriodMaps(db, actorIds, bounds);
    const consolidated = await loadNewPeriodMaps(actorIds, bounds);

    assert.ok(
      periodMapsEqual(legacy.followUps, consolidated.followUps),
      "follow-up period maps should match legacy",
    );
    assert.ok(
      periodMapsEqual(legacy.stageProgress, consolidated.stageProgress),
      "stage period maps should match legacy",
    );
  });

  it("applies follow-up boundary semantics identically to legacy", async () => {
    await cleanupFixture();
    await insertTestCustomer(TEST_CUSTOMER_A);
    const bounds = buildPeriodBounds(FIXED_NOW);
    const actorIds = [STAFF_A];
    const start7 = bounds[7].startIso;
    const start30 = bounds[30].startIso;
    const start90 = bounds[90].startIso;
    const endExclusive = bounds[7].endExclusiveIso;

    await insertFollowUp(FOLLOW_UP_IDS[0]!, STAFF_A, TEST_CUSTOMER_A, start7);
    await insertFollowUp(
      FOLLOW_UP_IDS[1]!,
      STAFF_A,
      TEST_CUSTOMER_A,
      isoBefore(start7),
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[2]!,
      STAFF_A,
      TEST_CUSTOMER_A,
      start30,
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[3]!,
      STAFF_A,
      TEST_CUSTOMER_A,
      isoBefore(start30),
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[4]!,
      STAFF_A,
      TEST_CUSTOMER_A,
      start90,
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[5]!,
      STAFF_A,
      TEST_CUSTOMER_A,
      isoBefore(start90),
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[6]!,
      STAFF_A,
      TEST_CUSTOMER_A,
      isoBefore(endExclusive),
    );
    await insertFollowUp(
      FOLLOW_UP_IDS[7]!,
      STAFF_A,
      TEST_CUSTOMER_A,
      endExclusive,
    );

    const legacy = await loadLegacyTeamPeriodMaps(db, actorIds, bounds);
    const consolidated = await loadNewPeriodMaps(actorIds, bounds);

    assert.ok(periodMapsEqual(legacy.followUps, consolidated.followUps));

    const count7 = legacy.followUps[7].get(STAFF_A) ?? 0;
    const count30 = legacy.followUps[30].get(STAFF_A) ?? 0;
    const count90 = legacy.followUps[90].get(STAFF_A) ?? 0;
    assert.ok(count7 <= count30 && count30 <= count90);
    assert.equal(count7, 2);
    assert.equal(count30, 4);
    assert.ok(count90 >= 5);
  });

  it("excludes follow-up at endExclusive and includes follow-up at start7", async () => {
    await cleanupFixture();
    await insertTestCustomer(TEST_CUSTOMER_A);
    const bounds = buildPeriodBounds(FIXED_NOW);
    const actorIds = [STAFF_A];
    const start7 = bounds[7].startIso;
    const endExclusive = bounds[7].endExclusiveIso;

    const baseline = await loadLegacyTeamPeriodMaps(db, actorIds, bounds);

    await insertFollowUp(FOLLOW_UP_IDS[0]!, STAFF_A, TEST_CUSTOMER_A, start7);
    const afterStart7 = await loadLegacyTeamPeriodMaps(db, actorIds, bounds);
    const consolidatedAfterStart7 = await loadNewPeriodMaps(actorIds, bounds);
    assert.ok(
      periodMapsEqual(afterStart7.followUps, consolidatedAfterStart7.followUps),
    );
    for (const days of [7, 30, 90] as TrendRangeDays[]) {
      assert.equal(
        (afterStart7.followUps[days].get(STAFF_A) ?? 0) -
          (baseline.followUps[days].get(STAFF_A) ?? 0),
        1,
      );
    }

    await insertFollowUp(
      FOLLOW_UP_IDS[1]!,
      STAFF_A,
      TEST_CUSTOMER_A,
      endExclusive,
    );
    const afterEndExclusive = await loadLegacyTeamPeriodMaps(db, actorIds, bounds);
    const consolidatedAfterEndExclusive = await loadNewPeriodMaps(
      actorIds,
      bounds,
    );
    assert.ok(
      periodMapsEqual(
        afterEndExclusive.followUps,
        consolidatedAfterEndExclusive.followUps,
      ),
    );
    for (const days of [7, 30, 90] as TrendRangeDays[]) {
      assert.equal(
        afterEndExclusive.followUps[days].get(STAFF_A) ?? 0,
        afterStart7.followUps[days].get(STAFF_A) ?? 0,
      );
    }
  });

  it("applies stage-progress distinct-customer semantics identically to legacy", async () => {
    await cleanupFixture();
    await insertTestCustomer(TEST_CUSTOMER_A);
    await insertTestCustomer(TEST_CUSTOMER_B);
    const bounds = buildPeriodBounds(FIXED_NOW);
    const actorIds = [STAFF_A];
    const start7 = bounds[7].startIso;

    await insertStageChange(
      STAGE_LOG_IDS[0]!,
      TEST_CUSTOMER_A,
      STAFF_A,
      start7,
    );
    await insertStageChange(
      STAGE_LOG_IDS[1]!,
      TEST_CUSTOMER_A,
      STAFF_A,
      isoAfter(start7),
    );
    await insertStageChange(
      STAGE_LOG_IDS[2]!,
      TEST_CUSTOMER_B,
      STAFF_A,
      start7,
    );

    const legacy = await loadLegacyTeamPeriodMaps(db, actorIds, bounds);
    const consolidated = await loadNewPeriodMaps(actorIds, bounds);

    assert.ok(periodMapsEqual(legacy.stageProgress, consolidated.stageProgress));
    assert.equal(legacy.stageProgress[7].get(STAFF_A), 2);
    assert.equal(legacy.stageProgress[30].get(STAFF_A), 2);
    assert.equal(legacy.stageProgress[90].get(STAFF_A), 2);
  });

  it("counts stage progress independently per actor", async () => {
    await cleanupFixture();
    await insertTestCustomer(TEST_CUSTOMER_A);
    const bounds = buildPeriodBounds(FIXED_NOW);
    const actorIds = [STAFF_A, STAFF_B];
    const start7 = bounds[7].startIso;

    await insertStageChange(
      STAGE_LOG_IDS[0]!,
      TEST_CUSTOMER_A,
      STAFF_A,
      start7,
    );
    await insertStageChange(
      STAGE_LOG_IDS[1]!,
      TEST_CUSTOMER_A,
      STAFF_B,
      start7,
    );

    const consolidated = await loadNewPeriodMaps(actorIds, bounds);
    assert.equal(consolidated.stageProgress[7].get(STAFF_A), 1);
    assert.equal(consolidated.stageProgress[7].get(STAFF_B), 1);
  });
});
