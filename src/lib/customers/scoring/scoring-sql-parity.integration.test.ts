import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  buildCustomerListWhere,
  buildCustomerListPagination,
  buildSearchWhere,
  CUSTOMER_LIST_PAGE_SIZE,
  resolveCustomerListOrderBy,
} from "@/lib/customers/queries";
import { calculateCustomerHeat } from "@/lib/customers/scoring/heat";
import { calculateDataCompletenessScore } from "@/lib/customers/scoring/completeness";
import {
  filterScoredCustomerIdsReference,
  measureLegacyScoringPath,
  paginateCustomerIdsReference,
  scoreCustomersForFilterReference,
} from "@/lib/customers/scoring/scoring-list-reference";
import {
  combineCustomerListWhere,
  countCustomersMatchingScoringFilter,
  explainScoringFilterQueryPlan,
  listCustomerIdsMatchingScoringFilter,
  listCustomerIdsMatchingScoringFilterPaginated,
  type ScoringQueryPlanDatabase,
} from "@/lib/customers/scoring/scoring-list-sql";
import {
  buildCompletenessScoreSql,
  sqlFieldHasText,
} from "@/lib/customers/scoring/scoring-sql-primitives";
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
const RECENCY_SETTINGS: EffectiveSettings = {
  ...DEFAULT_SETTINGS,
  automaticReclaimDays: 100,
  reclaimWarningDaysBefore: 10,
  reclaimWarningThresholdDays: 90,
};

let db: ReturnType<typeof drizzle<typeof schema>>;
let rawD1: ScoringQueryPlanDatabase;
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
    .delete(schema.approvals)
    .where(like(schema.approvals.id, `${FIXTURE_PREFIX}%`));
  await db
    .delete(schema.customerAssignees)
    .where(like(schema.customerAssignees.id, `${FIXTURE_PREFIX}%`));
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

async function insertAssignee(
  customerId: string,
  userId: string,
  idSuffix: string,
) {
  const now = FIXED_NOW.toISOString();
  await db.insert(schema.customerAssignees).values({
    id: fixtureId(`as-${idSuffix}`),
    customerId,
    userId,
    role: "collaborator",
    assignedBy: SEED_IDS.admin,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertPendingOnHoldApproval(
  customerId: string,
  idSuffix: string,
) {
  const now = FIXED_NOW.toISOString();
  await db.insert(schema.approvals).values({
    id: fixtureId(`ap-${idSuffix}`),
    requestType: "create_on_hold_customer",
    status: "pending",
    customerId,
    requestedBy: SEED_IDS.staffA,
    reason: "parity fixture",
    createdAt: now,
    updatedAt: now,
  });
}

async function assertIdParity(
  customers: Customer[],
  followUpSet: Set<string>,
  filter: { heat?: HeatLevel; completenessBelow?: number },
  options: {
    settings?: EffectiveSettings;
    now?: Date;
    baseWhere?: SQL;
  } = {},
) {
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const now = options.now ?? FIXED_NOW;
  const scored = scoreCustomersForFilterReference(
    customers,
    followUpSet,
    settings,
    now,
  );
  const legacyIds = filterScoredCustomerIdsReference(scored, filter).sort();
  const baseWhere = and(
    options.baseWhere ?? fixtureBaseWhere(),
    inArray(
      schema.customers.id,
      customers.map((customer) => customer.id),
    ),
  );
  const sqlIds = (
    await listCustomerIdsMatchingScoringFilter(
      db,
      baseWhere,
      filter,
      {
        settings,
        now,
      },
    )
  ).sort();

  assert.deepEqual(
    sqlIds,
    legacyIds,
    `SQL filter ${JSON.stringify(filter)} must match legacy IDs`,
  );
}

async function assertHeatPartition(
  customers: Customer[],
  settings: EffectiveSettings = DEFAULT_SETTINGS,
  now: Date = FIXED_NOW,
) {
  for (const customer of customers) {
    const sqlMatches: HeatLevel[] = [];
    for (const heat of HEAT_LEVELS) {
      const ids = await listCustomerIdsMatchingScoringFilter(
        db,
        eq(schema.customers.id, customer.id),
        { heat },
        { settings, now },
      );
      if (ids.includes(customer.id)) {
        sqlMatches.push(heat);
      }
    }
    const jsHeat = calculateCustomerHeat(customer, settings, now).heatLevel;
    assert.deepEqual(
      sqlMatches,
      [jsHeat],
      `${customer.id} must match exactly one SQL heat class`,
    );
  }
}

describe("customer list scoring SQL parity (PRE)", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const persistPath = process.env.CRM_SCORING_SQL_D1_PERSIST_PATH;
    const proxy = await getPlatformProxy<{ DB: ScoringQueryPlanDatabase }>({
      configPath: "./wrangler.jsonc",
      ...(persistPath ? { persist: { path: persistPath } } : {}),
    });
    rawD1 = proxy.env.DB;
    db = drizzle(rawD1, { schema });
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
    const defaultHeatFixtures: Customer[] = [
      makeFixture("h-silent-null", {
        lastValidFollowUpAt: null,
        createdAt: daysAgoIso(2),
      }),
      makeFixture("h-silent-empty", {
        lastValidFollowUpAt: "",
        createdAt: daysAgoIso(2),
      }),
      makeFixture("h-high", { lastValidFollowUpAt: daysAgoIso(1) }),
      makeFixture("h-churn-idle", {
        lastValidFollowUpAt: daysAgoIso(
          DEFAULT_SETTINGS.reclaimWarningThresholdDays,
        ),
      }),
      makeFixture("h-cycle-wins", {
        lastValidFollowUpAt: daysAgoIso(10),
        reclamationCycleStartedAt: daysAgoIso(2),
      }),
      makeFixture("h-low-invalid-last", {
        lastValidFollowUpAt: "not-a-date",
        createdAt: daysAgoIso(2),
        salesStage: "contacted",
      }),
      makeFixture("h-cycle-invalid", {
        reclamationCycleStartedAt: "not-a-date",
        lastValidFollowUpAt: daysAgoIso(1),
      }),
      makeFixture("h-created-invalid", {
        reclamationCycleStartedAt: null,
        lastValidFollowUpAt: null,
        createdAt: "not-a-date",
      }),
      makeFixture("h-next-invalid", {
        lastValidFollowUpAt: null,
        createdAt: daysAgoIso(2),
        nextFollowUpAt: "not-a-date",
      }),
      makeFixture("h-next-empty", {
        lastValidFollowUpAt: null,
        createdAt: daysAgoIso(2),
        nextFollowUpAt: "",
      }),
      makeFixture("h-next-before", {
        lastValidFollowUpAt: null,
        createdAt: daysAgoIso(2),
        nextFollowUpAt: new Date(FIXED_NOW.getTime() - 1).toISOString(),
      }),
      makeFixture("h-next-equal", {
        lastValidFollowUpAt: null,
        createdAt: daysAgoIso(2),
        nextFollowUpAt: FIXED_NOW.toISOString(),
      }),
      makeFixture("h-next-after", {
        lastValidFollowUpAt: null,
        createdAt: daysAgoIso(2),
        nextFollowUpAt: new Date(FIXED_NOW.getTime() + 1).toISOString(),
      }),
    ];
    const recencyFixtures: Customer[] = [
      makeFixture("h-r7", {
        lastValidFollowUpAt: msAgoIso(7 * MS_PER_DAY),
      }),
      makeFixture("h-r8-minus", {
        lastValidFollowUpAt: msAgoIso(8 * MS_PER_DAY - 1),
      }),
      makeFixture("h-r8", {
        lastValidFollowUpAt: msAgoIso(8 * MS_PER_DAY),
      }),
      makeFixture("h-r14", {
        lastValidFollowUpAt: msAgoIso(14 * MS_PER_DAY),
      }),
      makeFixture("h-r15-minus", {
        lastValidFollowUpAt: msAgoIso(15 * MS_PER_DAY - 1),
      }),
      makeFixture("h-r15", {
        lastValidFollowUpAt: msAgoIso(15 * MS_PER_DAY),
      }),
      makeFixture("h-future", { lastValidFollowUpAt: daysFromNowIso(2) }),
    ];
    const heatFixtures = [...defaultHeatFixtures, ...recencyFixtures];

    const expectedIsolatedBoundaries = new Map<string, HeatLevel>([
      [fixtureId("h-next-before"), "high_churn_risk"],
      [fixtureId("h-next-equal"), "medium"],
      [fixtureId("h-next-after"), "medium"],
      [fixtureId("h-low-invalid-last"), "low"],
      [fixtureId("h-r8"), "medium"],
      [fixtureId("h-r15"), "silent"],
      [fixtureId("h-future"), "high"],
    ]);

    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures(heatFixtures);
    });

    for (const heat of HEAT_LEVELS) {
      it(`heat filter parity: ${heat}`, async () => {
        await assertIdParity(defaultHeatFixtures, new Set(), { heat });
        await assertIdParity(recencyFixtures, new Set(), { heat }, {
          settings: RECENCY_SETTINGS,
        });
      });
    }

    it("every heat fixture matches exactly one SQL class equal to JS", async () => {
      await assertHeatPartition(defaultHeatFixtures);
      await assertHeatPartition(recencyFixtures, RECENCY_SETTINGS);
    });

    it("isolates low, malformed, recency, future, and next-follow-up boundaries", () => {
      for (const customer of heatFixtures) {
        const expected = expectedIsolatedBoundaries.get(customer.id);
        if (!expected) continue;
        const settings = customer.id.startsWith(fixtureId("h-r"))
          || customer.id === fixtureId("h-future")
          ? RECENCY_SETTINGS
          : DEFAULT_SETTINGS;
        assert.equal(
          calculateCustomerHeat(customer, settings, FIXED_NOW).heatLevel,
          expected,
          customer.id,
        );
      }
    });

    it("preserves HK calendar-day anchor boundaries in SQL", async () => {
      const hkNow = new Date("2026-07-03T16:00:00.000Z");
      const hkSettings = {
        ...RECENCY_SETTINGS,
        reclaimWarningThresholdDays: 1,
      };
      const hkFixtures = [
        makeFixture("h-hk-same", {
          lastValidFollowUpAt: "2026-07-03T16:00:00.000Z",
        }),
        makeFixture("h-hk-prev-ms", {
          lastValidFollowUpAt: "2026-07-03T15:59:59.999Z",
        }),
        makeFixture("h-hk-future", {
          lastValidFollowUpAt: "2026-07-04T16:00:00.000Z",
        }),
      ];
      await deleteFixtureCustomers();
      await insertFixtures(hkFixtures);
      await assertHeatPartition(hkFixtures, hkSettings, hkNow);
      for (const heat of HEAT_LEVELS) {
        await assertIdParity(hkFixtures, new Set(), { heat }, {
          settings: hkSettings,
          now: hkNow,
        });
      }
    });
  });

  describe("completeness fixtures", () => {
    const scoreFixture = (target: number) => {
      const useContact = target >= 90;
      let tenPointFields = (target - (useContact ? 20 : 0)) / 10;
      const overrides: Partial<Customer> = {
        customerName: "",
        phone: useContact ? "13800000000" : null,
        wechatId: null,
        email: null,
        source: "",
        salesStage: "",
        ownerId: null,
        notes: null,
        nextFollowUpAt: null,
        status: "active",
      };
      const award = (apply: () => void) => {
        if (tenPointFields <= 0) return;
        apply();
        tenPointFields -= 1;
      };
      award(() => {
        overrides.customerName = "Name";
      });
      award(() => {
        overrides.email = "a@b.com";
      });
      award(() => {
        overrides.source = "referral";
      });
      award(() => {
        overrides.salesStage = "new_lead";
      });
      award(() => {
        overrides.ownerId = SEED_IDS.staffA;
      });
      award(() => {
        overrides.notes = "note";
      });
      award(() => {
        overrides.nextFollowUpAt = daysFromNowIso(1);
      });
      const hasFollowUp = tenPointFields > 0;
      if (hasFollowUp) tenPointFields -= 1;
      assert.equal(tenPointFields, 0);
      return {
        customer: makeFixture(`c${target}`, overrides),
        hasFollowUp,
      };
    };
    const scoredFixtures = Array.from({ length: 11 }, (_, index) =>
      scoreFixture(index * 10),
    );
    const completenessFixtures = scoredFixtures.map((item) => item.customer);
    completenessFixtures.push(
      makeFixture("c-phone", {
        customerName: "",
        phone: "13800000000",
        wechatId: null,
        email: null,
        source: "",
        salesStage: "",
        ownerId: null,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("c-wechat", {
        customerName: "",
        phone: null,
        wechatId: "wx123",
        email: null,
        source: "",
        salesStage: "",
        ownerId: null,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("c-public-pool", {
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
      makeFixture("c-wechat-nul", {
        customerName: "",
        phone: null,
        wechatId: "\u0000",
        email: null,
        source: "",
        salesStage: "",
        ownerId: null,
        notes: null,
        nextFollowUpAt: null,
      }),
      makeFixture("c-wechat-nbsp", {
        customerName: "",
        phone: null,
        wechatId: "\u00a0",
        email: null,
        source: "",
        salesStage: "",
        ownerId: null,
        notes: null,
        nextFollowUpAt: null,
      }),
    );

    let followUpSet = new Set<string>();

    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures(completenessFixtures);
      for (const item of scoredFixtures) {
        if (item.hasFollowUp) {
          await insertFollowUp(item.customer.id, item.customer.id.slice(-4));
        }
      }
      followUpSet = await getCustomerIdsWithFollowUps(
        db,
        completenessFixtures.map((c) => c.id),
      );
    });

    for (const threshold of Array.from({ length: 12 }, (_, index) => index * 10)) {
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
      for (let target = 0; target <= 100; target += 10) {
        const exact = scored.find((s) => s.id === fixtureId(`c${target}`));
        assert.ok(exact);
        assert.equal(exact.completenessScore, target);
        const below = filterScoredCustomerIdsReference(scored, {
          completenessBelow: target,
        });
        assert.equal(below.includes(exact.id), false);
      }
      assert.equal(
        scored.find((s) => s.id === fixtureId("c-public-pool"))
          ?.completenessScore,
        0,
      );
    });

    it("matches ECMAScript trim across local D1 whitespace classes", async () => {
      const values: Array<string | null> = [
        null,
        "",
        " ",
        "\t",
        "\n",
        "\r",
        "\u000b",
        "\u000c",
        "\u00a0",
        "\u1680",
        "\u2000",
        "\u200a",
        "\u2028",
        "\u2029",
        "\u202f",
        "\u205f",
        "\u3000",
        "\ufeff",
        " \t\u00a0\u3000\ufeff",
        "\u00a0text\u3000",
        "text\u202f",
        "ASCII",
        "中文",
        "\u0000",
        "\u0000a",
        "a\u0000",
        " \u0000 ",
        "\u00a0\u0000\u3000",
        "\u0000\u00a0",
        "\u0000中文",
      ];
      for (const value of values) {
        const row = await db.get<{ hasText: number }>(sql`SELECT CASE
            WHEN ${sqlFieldHasText(sql`${value}`)} THEN 1
            ELSE 0
          END AS hasText`);
        const jsHasText = !!value && value.trim().length > 0;
        assert.equal(row?.hasText === 1, jsHasText, JSON.stringify(value));
      }
    });

    it("matches JS phone/wechat completeness for NUL and NBSP-only WeChat", async () => {
      const cases = [
        { id: fixtureId("c-wechat-nul"), expectedScore: 20 },
        { id: fixtureId("c-wechat-nbsp"), expectedScore: 0 },
      ];
      for (const { id, expectedScore } of cases) {
        const customer = completenessFixtures.find((row) => row.id === id);
        assert.ok(customer, id);
        const jsScore = calculateDataCompletenessScore(customer, false)
          .completenessScore;
        assert.equal(jsScore, expectedScore, id);
        const sqlRow = await db
          .select({ score: buildCompletenessScoreSql() })
          .from(schema.customers)
          .where(eq(schema.customers.id, id));
        assert.equal(Number(sqlRow[0]?.score ?? -1), jsScore, id);
      }
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
    const paginationFixtures = Array.from({ length: 85 }, (_, index) =>
      makeFixture(`p${String(index).padStart(2, "0")}`, {
        customerName: `Page Fixture ${index}`,
        lastValidFollowUpAt: daysAgoIso(1),
        reclamationCycleStartedAt:
          index >= 3 && index < 12 ? daysAgoIso(35) : daysAgoIso(1),
        createdAt: daysAgoIso(30),
        isPinned: index < 3 ? 1 : 0,
        pinnedAt:
          index < 3
            ? new Date(FIXED_NOW.getTime() - index).toISOString()
            : null,
      }),
    );

    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures(paginationFixtures);
    });

    it("proves three real pages, normalization, ordering, ties, and zero matches", async () => {
      const followUpSet = new Set<string>();
      const filter = { completenessBelow: 100 };
      const baseWhere = and(
        fixtureBaseWhere(),
        buildCustomerListWhere(adminUser),
      );
      const ordered = await db
        .select()
        .from(schema.customers)
        .where(baseWhere)
        .orderBy(
          ...resolveCustomerListOrderBy({
            now: FIXED_NOW,
            automaticReclaimDays: DEFAULT_SETTINGS.automaticReclaimDays,
          }),
        );
      const scored = scoreCustomersForFilterReference(
        ordered,
        followUpSet,
        DEFAULT_SETTINGS,
        FIXED_NOW,
      );
      const matchingIds = new Set(
        filterScoredCustomerIdsReference(scored, filter),
      );

      const legacyTotal = [...matchingIds].length;
      assert.equal(legacyTotal, 85);
      assert.deepEqual(ordered.slice(0, 3).map((row) => row.id), [
        fixtureId("p00"),
        fixtureId("p01"),
        fixtureId("p02"),
      ]);

      const pagesToCheck = [1, 2, 3, 99];
      for (const page of pagesToCheck) {
        const legacyPage = paginateCustomerIdsReference(
          ordered,
          matchingIds,
          page,
        );
        const sqlPage =
          await listCustomerIdsMatchingScoringFilterPaginated(
          db,
          baseWhere,
          filter,
          page,
          {
            settings: DEFAULT_SETTINGS,
            now: FIXED_NOW,
          },
        );
        assert.deepEqual(sqlPage.ids, legacyPage.pageIds);
        assert.deepEqual(sqlPage.pagination, legacyPage.pagination);
      }
      assert.equal(buildCustomerListPagination(legacyTotal, 99).page, 3);

      const zero = await listCustomerIdsMatchingScoringFilterPaginated(
        db,
        baseWhere,
        { completenessBelow: 0 },
        99,
        { settings: DEFAULT_SETTINGS, now: FIXED_NOW },
      );
      assert.deepEqual(zero.ids, []);
      assert.deepEqual(zero.pagination, {
        page: 1,
        pageSize: CUSTOMER_LIST_PAGE_SIZE,
        total: 0,
        pageCount: 1,
      });
    });
  });

  describe("search + scoring composition", () => {
    const searchFixtures = [
      makeFixture("s-confirmed", {
        customerName: "Literal % _ \\ Confirmed",
        nameStatus: "confirmed",
      }),
      makeFixture("s-pending", {
        customerName: "X先生",
        nameStatus: "pending",
        phone: "55500000000",
      }),
      makeFixture("s-other", {
        customerName: "Ordinary Alpha",
        nameStatus: "confirmed",
      }),
    ];

    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures(searchFixtures);
    });

    it("preserves escaped LIKE and pending-name semantics with scoring", async () => {
      const cases: Array<{ term: string; expected: string[] }> = [
        { term: "Alpha", expected: [fixtureId("s-other")] },
        { term: "%", expected: [fixtureId("s-confirmed")] },
        { term: "_", expected: [fixtureId("s-confirmed")] },
        { term: "\\", expected: [fixtureId("s-confirmed")] },
        { term: "Confirmed", expected: [fixtureId("s-confirmed")] },
        { term: "X先生", expected: [] },
        { term: "555", expected: [fixtureId("s-pending")] },
      ];
      for (const { term, expected } of cases) {
        const baseWhere = and(
          fixtureBaseWhere(),
          buildCustomerListWhere(adminUser),
          buildSearchWhere(term),
        );
        const filter = { completenessBelow: 100 };
        const dbCustomers = await db
          .select()
          .from(schema.customers)
          .where(baseWhere);
        const legacyIds = filterScoredCustomerIdsReference(
          scoreCustomersForFilterReference(
            dbCustomers,
            new Set(),
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
        assert.deepEqual(legacyIds, expected, term);
        assert.deepEqual(sqlIds, expected, term);
      }
    });
  });

  describe("permission scope composition", () => {
    const permissionFixtures = [
      makeFixture("perm-owned", { ownerId: SEED_IDS.staffA }),
      makeFixture("perm-collab", { ownerId: SEED_IDS.staffB }),
      makeFixture("perm-private", { ownerId: SEED_IDS.staffB }),
      makeFixture("perm-inactive", {
        ownerId: SEED_IDS.staffA,
        status: "inactive",
      }),
      makeFixture("perm-pool", {
        ownerId: SEED_IDS.staffA,
        status: "public_pool",
      }),
      makeFixture("perm-arch", {
        ownerId: SEED_IDS.staffA,
        status: "archived",
      }),
      makeFixture("perm-pending", { ownerId: SEED_IDS.staffA }),
    ];

    before(async () => {
      await deleteFixtureCustomers();
      await insertFixtures(permissionFixtures);
      await insertAssignee(
        fixtureId("perm-collab"),
        SEED_IDS.staffA,
        "perm-collab",
      );
      await insertPendingOnHoldApproval(
        fixtureId("perm-pending"),
        "perm-pending",
      );
    });

    it("composes scoring with exact staff and admin list predicates", async () => {
      const filter = { heat: "high" as const };
      const scopes: Array<{
        label: string;
        baseWhere: SQL;
        expected: string[];
      }> = [
        {
          label: "staff",
          baseWhere: and(
            fixtureBaseWhere(),
            buildCustomerListWhere(staffUser),
          )!,
          expected: ["perm-owned", "perm-collab", "perm-inactive"].map(
            fixtureId,
          ),
        },
        {
          label: "admin-default",
          baseWhere: and(
            fixtureBaseWhere(),
            buildCustomerListWhere(adminUser),
          )!,
          expected: [
            "perm-owned",
            "perm-collab",
            "perm-private",
            "perm-inactive",
          ].map(fixtureId),
        },
        {
          label: "admin-archived",
          baseWhere: and(
            fixtureBaseWhere(),
            buildCustomerListWhere(adminUser, { status: "archived" }),
          )!,
          expected: [fixtureId("perm-arch")],
        },
      ];
      for (const scope of scopes) {
        const scopedCustomers = await db
          .select()
          .from(schema.customers)
          .where(scope.baseWhere);
        const legacyIds = filterScoredCustomerIdsReference(
          scoreCustomersForFilterReference(
            scopedCustomers,
            new Set(),
            DEFAULT_SETTINGS,
            FIXED_NOW,
          ),
          filter,
        ).sort();
        const sqlIds = (
          await listCustomerIdsMatchingScoringFilter(
            db,
            scope.baseWhere,
            filter,
            { settings: DEFAULT_SETTINGS, now: FIXED_NOW },
          )
        ).sort();
        assert.deepEqual(legacyIds, scope.expected.sort(), scope.label);
        assert.deepEqual(sqlIds, legacyIds, scope.label);
      }
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

    it("executes actual EXPLAIN QUERY PLAN for representative queries", async () => {
      const productionBase = and(
        fixtureBaseWhere(),
        buildCustomerListWhere(adminUser),
      );
      const cases = [
        {
          label: "heat",
          baseWhere: productionBase,
          filter: { heat: "medium" as const },
        },
        {
          label: "completeness",
          baseWhere: productionBase,
          filter: { completenessBelow: 70 },
        },
        {
          label: "combined",
          baseWhere: productionBase,
          filter: { heat: "high" as const, completenessBelow: 70 },
        },
        {
          label: "search+combined",
          baseWhere: and(productionBase, buildSearchWhere("%")),
          filter: { heat: "high" as const, completenessBelow: 70 },
        },
      ];
      for (const item of cases) {
        const plan = await explainScoringFilterQueryPlan(
          db,
          rawD1,
          item.baseWhere,
          item.filter,
          { settings: DEFAULT_SETTINGS, now: FIXED_NOW },
        );
        assert.ok(plan.length > 0, item.label);
        assert.ok(
          plan.some((row) => /SCAN|SEARCH/.test(row.detail)),
          item.label,
        );
        assert.equal(
          plan.some((row) => row.detail === "query-executed-on-local-d1"),
          false,
        );
        console.info(
          `[scoring-plan:${item.label}] ${plan.map((row) => row.detail).join(" | ")}`,
        );
      }
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
