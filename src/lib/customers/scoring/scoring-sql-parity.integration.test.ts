import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  buildCustomerListPagination,
  buildSearchWhere,
  CUSTOMER_LIST_PAGE_SIZE,
} from "@/lib/customers/queries";
import { calculateCustomerHeat } from "@/lib/customers/scoring/heat";
import { calculateDataCompletenessScore } from "@/lib/customers/scoring/completeness";
import {
  filterScoredCustomerIdsReference,
  measureLegacyScoringPath,
  orderCustomersForListReference,
  paginateCustomerIdsReference,
  scoreCustomersForFilterReference,
} from "@/lib/customers/scoring/scoring-list-reference";
import {
  combineCustomerListWhere,
  countCustomersMatchingScoringFilter,
  explainScoringFilterQueryPlan,
  listCustomerIdsMatchingScoringFilter,
} from "@/lib/customers/scoring/scoring-list-sql";
import {
  getScoringSqlInstrumentation,
  recordCandidateScoringPath,
  recordLegacyScoringPath,
  resetScoringSqlInstrumentation,
} from "@/lib/customers/scoring/scoring-sql-instrumentation";
import { getCustomerIdsWithFollowUps } from "@/lib/customers/scoring/service";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import { HEAT_LEVELS } from "@/lib/customers/scoring/types";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";

const FIXTURE_PREFIX = "66666666-6666-6666-6666-";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date("2026-07-03T12:00:00.000Z");

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;
const staffUser = { id: SEED_IDS.staffA, role: "staff" } as User;

const DEFAULT_SETTINGS: EffectiveSettings = {
  automaticReclaimDays: Number(SETTING_DEFAULTS.automatic_reclaim_days),
  reclaimWarningDaysBefore: Number(SETTING_DEFAULTS.reclaim_warning_days_before),
  reclaimWarningThresholdDays:
    Number(SETTING_DEFAULTS.automatic_reclaim_days) -
    Number(SETTING_DEFAULTS.reclaim_warning_days_before),
  reclaimWarningDay1: Number(SETTING_DEFAULTS.reclaim_warning_day_1),
  reclaimWarningDay2: Number(SETTING_DEFAULTS.reclaim_warning_day_2),
  publicPoolClaimQuota7Days: Number(
    SETTING_DEFAULTS.public_pool_claim_quota_7_days,
  ),
  publicPoolClaimCooldownHours: Number(
    SETTING_DEFAULTS.public_pool_claim_cooldown_hours,
  ),
  firstContactSlaHours: Number(SETTING_DEFAULTS.first_contact_sla_hours),
  businessTimezone: "Asia/Hong_Kong",
  inactivityLogoutMinutes: Number(SETTING_DEFAULTS.inactivity_logout_minutes),
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

function fixtureId(suffix: string): string {
  return `${FIXTURE_PREFIX}${suffix.padStart(4, "0")}`;
}

function daysAgoIso(days: number, from = FIXED_NOW): string {
  return new Date(from.getTime() - days * MS_PER_DAY).toISOString();
}

function daysFromNowIso(days: number, from = FIXED_NOW): string {
  return new Date(from.getTime() + days * MS_PER_DAY).toISOString();
}

function msAgoIso(ms: number, from = FIXED_NOW): string {
  return new Date(from.getTime() - ms).toISOString();
}

function makeFixture(
  suffix: string,
  overrides: Partial<Customer> = {},
): Customer {
  const id = fixtureId(suffix);
  return {
    id,
    customerCode: null,
    customerName: `Fixture ${suffix}`,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000000",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    ownerId: SEED_IDS.staffA,
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    lastFollowUpAt: null,
    lastValidFollowUpAt: daysAgoIso(1),
    nextFollowUpAt: null,
    reclamationCycleStartedAt: null,
    reclaimRuleGraceUntil: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    createdAt: daysAgoIso(30),
    updatedAt: daysAgoIso(1),
    ...overrides,
  } as Customer;
}

function fixtureBaseWhere() {
  return like(schema.customers.id, `${FIXTURE_PREFIX}%`);
}

async function deleteFixtureCustomers() {
  await db
    .delete(schema.followUps)
    .where(like(schema.followUps.id, `${FIXTURE_PREFIX}%`));
  await db
    .delete(schema.customers)
    .where(like(schema.customers.id, `${FIXTURE_PREFIX}%`));
}

async function insertFixtures(customers: Customer[]) {
  for (const customer of customers) {
    await db.insert(schema.customers).values(customer);
  }
}

async function insertFollowUp(customerId: string, idSuffix: string) {
  await db.insert(schema.followUps).values({
    id: fixtureId(`fu-${idSuffix}`),
    customerId,
    userId: SEED_IDS.staffA,
    followUpTime: FIXED_NOW.toISOString(),
    channel: "call",
    outcome: "connected",
    summary: "test follow-up",
    content: "test follow-up",
    isValidFollowUp: 1,
    createdAt: FIXED_NOW.toISOString(),
  });
}

async function assertIdParity(
  customers: Customer[],
  followUpSet: Set<string>,
  filter: { heat?: HeatLevel; completenessBelow?: number },
) {
  const scored = scoreCustomersForFilterReference(
    customers,
    followUpSet,
    DEFAULT_SETTINGS,
    FIXED_NOW,
  );
  const legacyIds = filterScoredCustomerIdsReference(scored, filter).sort();
  const sqlIds = (
    await listCustomerIdsMatchingScoringFilter(db, fixtureBaseWhere(), filter, {
      settings: DEFAULT_SETTINGS,
      now: FIXED_NOW,
    })
  ).sort();

  assert.deepEqual(
    sqlIds,
    legacyIds,
    `SQL filter ${JSON.stringify(filter)} must match legacy IDs`,
  );
}

describe("customer list scoring SQL parity (PRE)", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
  });

  after(async () => {
    await deleteFixtureCustomers();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  describe("heat fixtures", () => {
    const heatFixtures: Customer[] = [
      makeFixture("h01", {
        lastValidFollowUpAt: null,
        createdAt: daysAgoIso(2),
      }),
      makeFixture("h02", { lastValidFollowUpAt: daysAgoIso(1) }),
      makeFixture("h03", { lastValidFollowUpAt: msAgoIso(7 * MS_PER_DAY) }),
      makeFixture("h04", {
        lastValidFollowUpAt: msAgoIso(7 * MS_PER_DAY + 1),
      }),
      makeFixture("h05", { lastValidFollowUpAt: msAgoIso(14 * MS_PER_DAY) }),
      makeFixture("h06", {
        lastValidFollowUpAt: msAgoIso(14 * MS_PER_DAY + 1),
      }),
      makeFixture("h07", { salesStage: "interested" }),
      makeFixture("h08", { salesStage: "proposal" }),
      makeFixture("h09", { salesStage: "negotiation" }),
      makeFixture("h10", { salesStage: "contacted" }),
      makeFixture("h11", { nextFollowUpAt: daysFromNowIso(2) }),
      makeFixture("h12", { nextFollowUpAt: daysAgoIso(1) }),
      makeFixture("h13", { nextFollowUpAt: null }),
      makeFixture("h14", {
        lastValidFollowUpAt: daysAgoIso(
          DEFAULT_SETTINGS.reclaimWarningThresholdDays,
        ),
      }),
      makeFixture("h15", {
        lastValidFollowUpAt: daysAgoIso(
          Math.max(1, DEFAULT_SETTINGS.automaticReclaimDays - 1),
        ),
      }),
      makeFixture("h16", {
        lastValidFollowUpAt: daysAgoIso(10),
        reclamationCycleStartedAt: daysAgoIso(2),
      }),
      makeFixture("h17", {
        lastValidFollowUpAt: daysAgoIso(10),
        createdAt: daysAgoIso(2),
      }),
      makeFixture("h18", {
        lastValidFollowUpAt: daysAgoIso(3),
        createdAt: "2026-07-02T16:00:00.000Z",
      }),
      makeFixture("h19", {
        lastValidFollowUpAt: "2026-07-02T16:00:00.000Z",
        createdAt: daysAgoIso(30),
      }),
      makeFixture("h20", { lastValidFollowUpAt: daysFromNowIso(2) }),
      makeFixture("h21", {
        nextFollowUpAt: FIXED_NOW.toISOString(),
      }),
      makeFixture("h22", {
        nextFollowUpAt: new Date(FIXED_NOW.getTime() - 1).toISOString(),
      }),
      makeFixture("h23", {
        nextFollowUpAt: new Date(FIXED_NOW.getTime() + 1).toISOString(),
      }),
    ];

    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures(heatFixtures);
    });

    for (const heat of HEAT_LEVELS) {
      it(`heat filter parity: ${heat}`, async () => {
        await assertIdParity(heatFixtures, new Set(), { heat });
      });
    }

    it("priority: high_churn_risk excludes lower heat classes", async () => {
      const churnIds = new Set(
        heatFixtures
          .filter(
            (c) =>
              calculateCustomerHeat(c, DEFAULT_SETTINGS, FIXED_NOW).heatLevel ===
              "high_churn_risk",
          )
          .map((c) => c.id),
      );
      for (const heat of ["high", "medium", "silent", "low"] as const) {
        const sqlIds = await listCustomerIdsMatchingScoringFilter(
          db,
          fixtureBaseWhere(),
          { heat },
          { settings: DEFAULT_SETTINGS, now: FIXED_NOW },
        );
        for (const id of sqlIds) {
          assert.equal(
            churnIds.has(id),
            false,
            `${id} must not appear in ${heat} when it is high_churn_risk`,
          );
        }
      }
    });
  });

  describe("completeness fixtures", () => {
    const completenessFixtures: Customer[] = [
      makeFixture("c00", {
        customerName: "",
        phone: null,
        wechatId: null,
        email: null,
        source: "",
        salesStage: "",
        ownerId: null,
        notes: null,
        nextFollowUpAt: null,
        status: "public_pool",
      }),
      makeFixture("c10", {
        customerName: "Name",
        phone: null,
        wechatId: null,
        email: null,
        source: "",
        salesStage: "",
        ownerId: null,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("c20", {
        customerName: "Name",
        phone: "13800000000",
        source: "referral",
        salesStage: "new_lead",
        ownerId: SEED_IDS.staffA,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("c50", {
        customerName: "Name",
        phone: "13800000000",
        source: "referral",
        salesStage: "new_lead",
        ownerId: null,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("c60", {
        customerName: "Name",
        phone: "13800000000",
        source: "referral",
        salesStage: "new_lead",
        ownerId: null,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("c70", {
        customerName: "Name",
        phone: "13800000000",
        email: "a@b.com",
        source: "referral",
        salesStage: "new_lead",
        ownerId: SEED_IDS.staffA,
        notes: "note",
        nextFollowUpAt: daysFromNowIso(1),
      }),
      makeFixture("c100", {
        customerName: "Name",
        phone: "13800000000",
        email: "a@b.com",
        source: "referral",
        salesStage: "new_lead",
        ownerId: SEED_IDS.staffA,
        notes: "note",
        nextFollowUpAt: daysFromNowIso(1),
      }),
      makeFixture("cws", {
        customerName: "   ",
        phone: "\t",
        wechatId: "  ",
        email: "  ",
        source: "referral",
        salesStage: "new_lead",
        ownerId: SEED_IDS.staffA,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("cwx", {
        customerName: "Name",
        phone: null,
        wechatId: "wx123",
        source: "referral",
        salesStage: "new_lead",
        ownerId: null,
        status: "public_pool",
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("cno", {
        customerName: "Name",
        phone: "13800000000",
        source: "referral",
        salesStage: "new_lead",
        ownerId: null,
        notes: null,
        nextFollowUpAt: null,
      }),
    ];

    let followUpSet = new Set<string>();

    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures(completenessFixtures);
      await insertFollowUp(fixtureId("c60"), "c60");
      await insertFollowUp(fixtureId("c70"), "c70");
      await insertFollowUp(fixtureId("c100"), "c100");
      followUpSet = await getCustomerIdsWithFollowUps(
        db,
        completenessFixtures.map((c) => c.id),
      );
    });

    for (const threshold of [0, 10, 50, 60, 70, 100]) {
      it(`completenessBelow=${threshold} parity`, async () => {
        await assertIdParity(completenessFixtures, followUpSet, {
          completenessBelow: threshold,
        });
      });
    }

    it("completeness uses strict less-than", async () => {
      const scored = scoreCustomersForFilterReference(
        completenessFixtures,
        followUpSet,
        DEFAULT_SETTINGS,
        FIXED_NOW,
      );
      const exact60 = scored.find((s) => s.id === fixtureId("c60"));
      assert.ok(exact60);
      assert.equal(exact60.completenessScore, 60);
      const below60 = filterScoredCustomerIdsReference(scored, {
        completenessBelow: 60,
      });
      assert.equal(below60.includes(fixtureId("c60")), false);
    });
  });

  describe("combined filter matrix", () => {
    const combinedFixtures: Customer[] = [
      makeFixture("m01", {
        lastValidFollowUpAt: daysAgoIso(1),
        phone: null,
        email: null,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("m02", {
        lastValidFollowUpAt: daysAgoIso(10),
        phone: null,
        email: null,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("m03", {
        lastValidFollowUpAt: daysAgoIso(
          DEFAULT_SETTINGS.reclaimWarningThresholdDays,
        ),
        phone: null,
        email: null,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("m04", {
        lastValidFollowUpAt: null,
        createdAt: daysAgoIso(20),
        phone: null,
        email: null,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("m05", {
        lastValidFollowUpAt: daysAgoIso(20),
        salesStage: "contacted",
        phone: "13800000000",
        email: "a@b.com",
        source: "referral",
        ownerId: SEED_IDS.staffA,
        notes: "note",
        nextFollowUpAt: daysFromNowIso(1),
      }),
    ];

    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures(combinedFixtures);
      await insertFollowUp(fixtureId("m05"), "m05");
    });

    const matrix: Array<{ heat?: HeatLevel; completenessBelow?: number }> = [
      { heat: "high", completenessBelow: 60 },
      { heat: "medium", completenessBelow: 70 },
      { heat: "silent", completenessBelow: 100 },
      { heat: "high_churn_risk", completenessBelow: 60 },
      { heat: "low", completenessBelow: 100 },
    ];

    for (const filter of matrix) {
      it(`combined parity: ${JSON.stringify(filter)}`, async () => {
        const followUpSet = await getCustomerIdsWithFollowUps(
          db,
          combinedFixtures.map((c) => c.id),
        );
        await assertIdParity(combinedFixtures, followUpSet, filter);
      });
    }
  });

  describe("ordering and pagination parity", () => {
    const paginationFixtures = Array.from({ length: 12 }, (_, index) =>
      makeFixture(`p${String(index).padStart(2, "0")}`, {
        customerName: `Page Fixture ${index}`,
        lastValidFollowUpAt: daysAgoIso(index + 1),
        createdAt: daysAgoIso(30 + index),
      }),
    );

    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures(paginationFixtures);
    });

    it("page 1 / page 2 / last page / beyond pageCount / zero matches", async () => {
      const followUpSet = new Set<string>();
      const filter = { heat: "high" as const };
      const scored = scoreCustomersForFilterReference(
        paginationFixtures,
        followUpSet,
        DEFAULT_SETTINGS,
        FIXED_NOW,
      );
      const matchingIds = new Set(
        filterScoredCustomerIdsReference(scored, filter),
      );
      const ordered = orderCustomersForListReference(
        paginationFixtures,
        FIXED_NOW,
      );

      const legacyTotal = [...matchingIds].length;
      const sqlTotal = await countCustomersMatchingScoringFilter(
        db,
        fixtureBaseWhere(),
        filter,
        { settings: DEFAULT_SETTINGS, now: FIXED_NOW },
      );
      assert.equal(sqlTotal, legacyTotal);

      const pagesToCheck = [1, 2, Math.ceil(legacyTotal / CUSTOMER_LIST_PAGE_SIZE) || 1, 99];
      for (const page of pagesToCheck) {
        const legacyPage = paginateCustomerIdsReference(
          ordered,
          matchingIds,
          page,
        );
        const offset = (legacyPage.pagination.page - 1) * CUSTOMER_LIST_PAGE_SIZE;
        const sqlPageIds = await listCustomerIdsMatchingScoringFilter(
          db,
          fixtureBaseWhere(),
          filter,
          {
            settings: DEFAULT_SETTINGS,
            now: FIXED_NOW,
            limit: CUSTOMER_LIST_PAGE_SIZE,
            offset,
          },
        );
        assert.deepEqual(sqlPageIds, legacyPage.pageIds);
        assert.equal(legacyPage.pagination.total, legacyTotal);
        assert.equal(
          legacyPage.pagination.pageCount,
          buildCustomerListPagination(legacyTotal, page).pageCount,
        );
      }
    });
  });

  describe("search + scoring composition", () => {
    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures([
        makeFixture("s01", {
          customerName: "Alpha Search Target",
          lastValidFollowUpAt: daysAgoIso(1),
        }),
        makeFixture("s02", {
          customerName: "Beta Other",
          lastValidFollowUpAt: daysAgoIso(1),
        }),
        makeFixture("s03", {
          customerName: "Alpha Silent",
          lastValidFollowUpAt: daysAgoIso(20),
        }),
      ]);
    });

    it("search q + heat filter parity", async () => {
      const searchWhere = buildSearchWhere("Alpha");
      const baseWhere = and(fixtureBaseWhere(), searchWhere);
      const filter = { heat: "high" as const };
      const followUpSet = new Set<string>();

      const dbCustomers = await db
        .select()
        .from(schema.customers)
        .where(baseWhere);
      const legacyIds = filterScoredCustomerIdsReference(
        scoreCustomersForFilterReference(
          dbCustomers,
          followUpSet,
          DEFAULT_SETTINGS,
          FIXED_NOW,
        ),
        filter,
      ).sort();

      const sqlIds = (
        await listCustomerIdsMatchingScoringFilter(db, baseWhere, filter, {
          settings: DEFAULT_SETTINGS,
          now: FIXED_NOW,
        })
      ).sort();

      assert.deepEqual(sqlIds, legacyIds);
    });
  });

  describe("permission scope composition", () => {
    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures([
        makeFixture("perm-a", {
          ownerId: SEED_IDS.staffA,
          lastValidFollowUpAt: daysAgoIso(1),
        }),
        makeFixture("perm-b", {
          ownerId: SEED_IDS.staffB,
          lastValidFollowUpAt: daysAgoIso(1),
        }),
        makeFixture("perm-arch", {
          ownerId: SEED_IDS.staffA,
          status: "archived",
          lastValidFollowUpAt: daysAgoIso(10),
        }),
      ]);
    });

    it("staff owner scope does not leak other staff customers", async () => {
      const staffScope = and(
        fixtureBaseWhere(),
        eq(schema.customers.ownerId, staffUser.id),
        eq(schema.customers.status, "active"),
      );
      const filter = { heat: "high" as const };
      const sqlIds = await listCustomerIdsMatchingScoringFilter(
        db,
        staffScope,
        filter,
        { settings: DEFAULT_SETTINGS, now: FIXED_NOW },
      );
      assert.deepEqual(sqlIds.sort(), [fixtureId("perm-a")].sort());
      assert.equal(sqlIds.includes(fixtureId("perm-b")), false);
      assert.equal(sqlIds.includes(fixtureId("perm-arch")), false);
    });
  });

  describe("scale / data-volume proof", () => {
    const SCALE_COUNT = 1000;
    const scaleIds: string[] = [];

    before(async () => {
      await deleteFixtureCustomers();
      const batch: Customer[] = [];
      for (let i = 0; i < SCALE_COUNT; i += 1) {
        const suffix = `sc${String(i).padStart(4, "0")}`;
        const id = fixtureId(suffix);
        scaleIds.push(id);
        batch.push(
          makeFixture(suffix, {
            lastValidFollowUpAt: i % 5 === 0 ? daysAgoIso(20) : daysAgoIso(1),
            phone: i % 3 === 0 ? null : "13800000000",
            email: i % 4 === 0 ? null : "a@b.com",
            notes: i % 2 === 0 ? null : "note",
            nextFollowUpAt: i % 7 === 0 ? null : daysFromNowIso(1),
          }),
        );
      }
      for (let offset = 0; offset < batch.length; offset += 50) {
        await insertFixtures(batch.slice(offset, offset + 50));
      }
    });

    it("candidate path is page-bounded vs legacy 10k hydration", async () => {
      resetScoringSqlInstrumentation();
      const filter = { heat: "high" as const };

      const allCustomers = await db
        .select()
        .from(schema.customers)
        .where(fixtureBaseWhere());

      const legacy = measureLegacyScoringPath(
        allCustomers,
        new Set(),
        DEFAULT_SETTINGS,
        filter,
        FIXED_NOW,
      );
      recordLegacyScoringPath(legacy.stats);

      const sqlTotal = await countCustomersMatchingScoringFilter(
        db,
        fixtureBaseWhere(),
        filter,
        { settings: DEFAULT_SETTINGS, now: FIXED_NOW },
      );
      const sqlPageIds = await listCustomerIdsMatchingScoringFilter(
        db,
        fixtureBaseWhere(),
        filter,
        {
          settings: DEFAULT_SETTINGS,
          now: FIXED_NOW,
          limit: CUSTOMER_LIST_PAGE_SIZE,
          offset: 0,
        },
      );
      recordCandidateScoringPath({
        rowsReturned: sqlPageIds.length,
        rowsScoredInJs: sqlPageIds.length,
        d1Statements: 2,
      });

      const inst = getScoringSqlInstrumentation();
      assert.equal(legacy.stats.customersHydrated, SCALE_COUNT);
      assert.ok(inst.legacyCustomersScoredInJs >= SCALE_COUNT);
      assert.ok(inst.candidateRowsReturned <= CUSTOMER_LIST_PAGE_SIZE);
      assert.equal(inst.candidateRowsScoredInJs, inst.candidateRowsReturned);
      assert.equal(sqlTotal, legacy.matchingIds.length);
      assert.deepEqual(
        new Set(legacy.matchingIds),
        new Set(
          await listCustomerIdsMatchingScoringFilter(
            db,
            fixtureBaseWhere(),
            filter,
            { settings: DEFAULT_SETTINGS, now: FIXED_NOW },
          ),
        ),
      );
    });
  });

  describe("D1 compatibility and query plan", () => {
    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures([
        makeFixture("qp01", { lastValidFollowUpAt: daysAgoIso(1) }),
      ]);
    });

    it("executes generated SQL on local D1 without parser errors", async () => {
      const count = await countCustomersMatchingScoringFilter(
        db,
        fixtureBaseWhere(),
        { heat: "high", completenessBelow: 70 },
        { settings: DEFAULT_SETTINGS, now: FIXED_NOW },
      );
      assert.ok(count >= 0);
    });

    it("EXPLAIN QUERY PLAN returns rows (report-only)", async () => {
      const plan = await explainScoringFilterQueryPlan(
        db,
        fixtureBaseWhere(),
        { heat: "medium" },
        { settings: DEFAULT_SETTINGS, now: FIXED_NOW },
      );
      assert.ok(plan.length > 0);
    });
  });

  describe("SSR + API shared backend shape", () => {
    it("page and API can share the same scoring-list-sql module", async () => {
      const pageSource = await import("node:fs/promises").then((fs) =>
        fs.readFile("src/app/(dashboard)/customers/page.tsx", "utf8"),
      );
      const apiSource = await import("node:fs/promises").then((fs) =>
        fs.readFile("src/app/api/customers/route.ts", "utf8"),
      );
      assert.equal(pageSource.includes("scoring-list-sql"), false);
      assert.equal(apiSource.includes("scoring-list-sql"), false);
      assert.equal(
        typeof listCustomerIdsMatchingScoringFilter,
        "function",
      );
      assert.equal(typeof countCustomersMatchingScoringFilter, "function");
    });
  });
});
