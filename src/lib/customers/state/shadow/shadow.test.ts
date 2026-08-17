import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Customer } from "../../../../../drizzle/schema/customers";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import {
  getCustomerScores,
  getCustomersWithScores,
} from "@/lib/customers/scoring/service";
import { calculateCustomerHeat } from "@/lib/customers/scoring/heat";
import {
  assertShadowAggregateLogHasNoPii,
  assertShadowTelemetryHasNoPii,
  buildStateV2ShadowDetailRequestSeed,
  buildStateV2ShadowListRequestSeed,
  getShadowCircuitStateForTests,
  getShadowTelemetrySnapshot,
  hashShadowSeed,
  isShadowSampleRequest,
  isStateV2ShadowGloballyEnabled,
  maybeRunStateV2ShadowBatch,
  resetShadowCircuitForTests,
  resetShadowTelemetryForTests,
  resetShadowTelemetryLogForTests,
  setShadowLogSinkForTests,
  SHADOW_CUSTOMERS_EMIT_THRESHOLD,
} from "./index";

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

const FIXED_NOW = new Date("2026-08-16T04:00:00.000Z");

function makeCustomer(id: string): Customer {
  return {
    id,
    customerCode: null,
    customerName: "Shadow Test",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000000",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: "PROJ-1",
    primaryConcern: null,
    notes: "notes",
    salesStage: "contacted",
    ownerId: "owner-a",
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: "owner-a",
    updatedBy: "owner-a",
    lastFollowUpAt: null,
    lastValidFollowUpAt: "2026-08-10T04:00:00.000Z",
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    createdAt: "2026-07-01T04:00:00.000Z",
    updatedAt: "2026-08-16T04:00:00.000Z",
  } as Customer;
}

function sampledSeed(prefix: string): string {
  for (let index = 0; index < 10_000; index += 1) {
    const seed = `${prefix}-${index}`;
    if (isShadowSampleRequest(seed)) return seed;
  }
  throw new Error("unable to find sampled seed");
}

function unsampledSeed(prefix: string): string {
  for (let index = 0; index < 10_000; index += 1) {
    const seed = `${prefix}-u-${index}`;
    if (!isShadowSampleRequest(seed)) return seed;
  }
  throw new Error("unable to find unsampled seed");
}

const adminUser = {
  id: "admin-shadow",
  role: "admin",
} as import("../../../../../drizzle/schema/users").User;

describe("Customer State V2 production shadow (C3)", () => {
  const previousShadowFlag = process.env.CRM_STATE_SHADOW;

  afterEach(() => {
    if (previousShadowFlag === undefined) {
      delete process.env.CRM_STATE_SHADOW;
    } else {
      process.env.CRM_STATE_SHADOW = previousShadowFlag;
    }
    resetShadowTelemetryForTests();
    resetShadowCircuitForTests();
    resetShadowTelemetryLogForTests();
  });

  it("missing env disables shadow (fail-closed)", () => {
    delete process.env.CRM_STATE_SHADOW;
    assert.equal(isStateV2ShadowGloballyEnabled(), false);
  });

  it("env=1 enables shadow", () => {
    process.env.CRM_STATE_SHADOW = "1";
    assert.equal(isStateV2ShadowGloballyEnabled(), true);
  });

  it("env=0 or other values disable shadow", () => {
    process.env.CRM_STATE_SHADOW = "0";
    assert.equal(isStateV2ShadowGloballyEnabled(), false);
    process.env.CRM_STATE_SHADOW = "true";
    assert.equal(isStateV2ShadowGloballyEnabled(), false);
    process.env.CRM_STATE_SHADOW = "production";
    assert.equal(isStateV2ShadowGloballyEnabled(), false);
  });

  it("samples deterministically at ~5%", () => {
    const seed = "deterministic-shadow-seed";
    const first = isShadowSampleRequest(seed);
    const second = isShadowSampleRequest(seed);
    assert.equal(first, second);
    assert.equal(typeof hashShadowSeed(seed), "number");
  });

  it("unsampled path performs no V2 shadow comparisons", () => {
    process.env.CRM_STATE_SHADOW = "1";
    const customer = makeCustomer("cust-unsampled");
    const legacy = getCustomerScores(
      customer,
      { hasFollowUp: false },
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );

    maybeRunStateV2ShadowBatch({
      requestSeed: unsampledSeed("batch"),
      route: "list",
      settings: DEFAULT_SETTINGS,
      now: FIXED_NOW,
      customers: [{ customer, legacyScores: legacy, hasFollowUp: false }],
    });

    const snapshot = getShadowTelemetrySnapshot();
    assert.equal(snapshot.customersCompared, 0);
    assert.equal(snapshot.requestsSkippedUnsampled, 1);
  });

  it("sampled path reuses supplied facts without extra reads", () => {
    process.env.CRM_STATE_SHADOW = "1";
    const customer = makeCustomer("cust-sampled");
    const legacy = getCustomerScores(
      customer,
      { hasFollowUp: true },
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );

    maybeRunStateV2ShadowBatch({
      requestSeed: sampledSeed("batch"),
      route: "list",
      settings: DEFAULT_SETTINGS,
      now: FIXED_NOW,
      customers: [
        {
          customer,
          legacyScores: legacy,
          hasFollowUp: true,
          followUpOutcomes: [{ outcome: "no_reply", followUpTime: "2026-08-12T04:00:00.000Z" }],
        },
      ],
    });

    const snapshot = getShadowTelemetrySnapshot();
    assert.equal(snapshot.requestsSampled, 1);
    assert.equal(snapshot.customersCompared, 1);
    assert.ok(Object.keys(snapshot.comparisons).length > 0);
    assert.ok(
      Object.keys(snapshot.comparisons).some((key) =>
        key.startsWith("v2_attention_"),
      ),
    );
  });

  it("detail route skips when follow-up facts are unavailable", () => {
    process.env.CRM_STATE_SHADOW = "1";
    const customer = makeCustomer("cust-detail-skip");
    const legacy = getCustomerScores(
      customer,
      { hasFollowUp: false },
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );

    maybeRunStateV2ShadowBatch({
      requestSeed: sampledSeed("detail"),
      route: "detail",
      settings: DEFAULT_SETTINGS,
      now: FIXED_NOW,
      customers: [{ customer, legacyScores: legacy, hasFollowUp: false }],
    });

    const snapshot = getShadowTelemetrySnapshot();
    assert.equal(snapshot.customersCompared, 0);
    assert.equal(snapshot.skippedInsufficientFacts, 1);
  });

  it("isolates shadow exceptions without bubbling", () => {
    process.env.CRM_STATE_SHADOW = "1";
    const brokenCustomer = makeCustomer("cust-broken");
    Object.defineProperty(brokenCustomer, "salesStage", {
      get() {
        throw new Error("shadow-only failure");
      },
    });
    const legacy = getCustomerScores(
      makeCustomer("cust-safe"),
      { hasFollowUp: false },
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );

    maybeRunStateV2ShadowBatch({
      requestSeed: sampledSeed("error"),
      route: "list",
      settings: DEFAULT_SETTINGS,
      now: FIXED_NOW,
      customers: [
        { customer: brokenCustomer, legacyScores: legacy, hasFollowUp: false },
      ],
    });

    const snapshot = getShadowTelemetrySnapshot();
    assert.equal(snapshot.shadowErrors, 1);
  });

  it("opens the circuit breaker after repeated shadow errors", () => {
    process.env.CRM_STATE_SHADOW = "1";
    const brokenCustomer = makeCustomer("cust-breaker");
    Object.defineProperty(brokenCustomer, "salesStage", {
      get() {
        throw new Error("breaker");
      },
    });
    const legacy = getCustomerScores(
      makeCustomer("cust-safe-2"),
      { hasFollowUp: false },
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    const seed = sampledSeed("breaker");

    for (let index = 0; index < 5; index += 1) {
      maybeRunStateV2ShadowBatch({
        requestSeed: seed,
        route: "list",
        settings: DEFAULT_SETTINGS,
        now: FIXED_NOW,
        customers: [
          { customer: brokenCustomer, legacyScores: legacy, hasFollowUp: false },
        ],
      });
    }

    resetShadowTelemetryForTests();
    maybeRunStateV2ShadowBatch({
      requestSeed: seed,
      route: "list",
      settings: DEFAULT_SETTINGS,
      now: FIXED_NOW,
      customers: [
        {
          customer: makeCustomer("cust-after-breaker"),
          legacyScores: legacy,
          hasFollowUp: false,
        },
      ],
    });

    assert.ok(getShadowCircuitStateForTests().openUntilMs > Date.now());
    const snapshot = getShadowTelemetrySnapshot();
    assert.equal(snapshot.requestsSkippedCircuitOpen, 1);
    assert.equal(snapshot.customersCompared, 0);
  });

  it("telemetry contains only aggregate counters without PII", () => {
    process.env.CRM_STATE_SHADOW = "1";
    const customer = makeCustomer("cust-telemetry");
    const legacy = getCustomerScores(
      customer,
      { hasFollowUp: false },
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );

    maybeRunStateV2ShadowBatch({
      requestSeed: sampledSeed("telemetry"),
      route: "list",
      settings: DEFAULT_SETTINGS,
      now: FIXED_NOW,
      customers: [{ customer, legacyScores: legacy, hasFollowUp: false }],
    });

    assertShadowTelemetryHasNoPii(getShadowTelemetrySnapshot());
  });

  it("records expected legacy-to-V2 comparison categories", () => {
    process.env.CRM_STATE_SHADOW = "1";
    const customer = makeCustomer("cust-categories");
    const legacy = getCustomerScores(
      customer,
      { hasFollowUp: true },
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );

    maybeRunStateV2ShadowBatch({
      requestSeed: sampledSeed("categories"),
      route: "list",
      settings: DEFAULT_SETTINGS,
      now: FIXED_NOW,
      customers: [{ customer, legacyScores: legacy, hasFollowUp: true }],
    });

    const { comparisons } = getShadowTelemetrySnapshot();
    assert.ok(
      Object.keys(comparisons).some((key) => key.startsWith("legacy_heat_")),
    );
    assert.ok(Object.keys(comparisons).some((key) => key.startsWith("v2_churn_")));
    assert.ok(
      Object.keys(comparisons).some((key) => key.startsWith("v2_attention_")),
    );
  });

  it("leaves scoring output unchanged when shadow hook runs", () => {
    process.env.CRM_STATE_SHADOW = "1";
    const customers = [makeCustomer("cust-output-a"), makeCustomer("cust-output-b")];
    const followUpSet = new Set<string>([customers[0]!.id]);

    const withoutHook = customers.map((customer) => {
      const scores = getCustomerScores(
        customer,
        { hasFollowUp: followUpSet.has(customer.id) },
        DEFAULT_SETTINGS,
        FIXED_NOW,
      );
      return {
        heatLevel: scores.heatLevel,
        completenessScore: scores.completenessScore,
        reclamationCountdown: scores.reclamationCountdown,
      };
    });

    resetShadowTelemetryForTests();
    const withHook = getCustomersWithScores(
      adminUser,
      customers,
      followUpSet,
      DEFAULT_SETTINGS,
      FIXED_NOW,
    ).map((row) => ({
      heatLevel: row.heatLevel,
      completenessScore: row.completenessScore,
      reclamationCountdown: row.reclamationCountdown,
    }));

    assert.deepEqual(withHook, withoutHook);
    assert.deepEqual(
      withHook.map((row) => row.heatLevel),
      customers.map((customer) =>
        calculateCustomerHeat(customer, DEFAULT_SETTINGS, FIXED_NOW).heatLevel,
      ),
    );
  });

  it("builds stable list and detail request seeds", () => {
    const customers = [makeCustomer("a"), makeCustomer("b")];
    const listSeed = buildStateV2ShadowListRequestSeed("user-1", customers);
    assert.equal(
      listSeed,
      buildStateV2ShadowListRequestSeed("user-1", customers),
    );
    const detailSeed = buildStateV2ShadowDetailRequestSeed("user-1", "a");
    assert.equal(detailSeed, "detail:user-1:a");
  });

  it("emits bounded aggregate logs without PII after threshold", () => {
    process.env.CRM_STATE_SHADOW = "1";
    const logs: string[] = [];
    setShadowLogSinkForTests((line) => {
      logs.push(line);
    });

    const customer = makeCustomer("cust-log");
    const legacy = getCustomerScores(
      customer,
      { hasFollowUp: false },
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    const seed = sampledSeed("aggregate-log");

    for (let index = 0; index < SHADOW_CUSTOMERS_EMIT_THRESHOLD; index += 1) {
      maybeRunStateV2ShadowBatch({
        requestSeed: seed,
        route: "list",
        settings: DEFAULT_SETTINGS,
        now: FIXED_NOW,
        customers: [{ customer, legacyScores: legacy, hasFollowUp: false }],
      });
    }

    assert.equal(logs.length, 1);
    const payload = JSON.parse(logs[0]!) as {
      type: string;
      customersCompared: number;
      comparisons: Record<string, number>;
    };
    assert.equal(payload.type, "state_v2_shadow_aggregate");
    assert.equal(payload.customersCompared, SHADOW_CUSTOMERS_EMIT_THRESHOLD);
    assert.ok(Object.keys(payload.comparisons).length > 0);
    assertShadowAggregateLogHasNoPii(logs[0]!);
  });

  it("does not emit one log line per request", () => {
    process.env.CRM_STATE_SHADOW = "1";
    const logs: string[] = [];
    setShadowLogSinkForTests((line) => {
      logs.push(line);
    });

    const customer = makeCustomer("cust-no-spam");
    const legacy = getCustomerScores(
      customer,
      { hasFollowUp: false },
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    const seed = sampledSeed("no-spam");

    for (let index = 0; index < SHADOW_CUSTOMERS_EMIT_THRESHOLD - 1; index += 1) {
      maybeRunStateV2ShadowBatch({
        requestSeed: seed,
        route: "list",
        settings: DEFAULT_SETTINGS,
        now: FIXED_NOW,
        customers: [{ customer, legacyScores: legacy, hasFollowUp: false }],
      });
    }

    assert.equal(logs.length, 0);
  });

  it("logging exceptions cannot fail shadow or primary path", () => {
    process.env.CRM_STATE_SHADOW = "1";
    setShadowLogSinkForTests(() => {
      throw new Error("log sink failure");
    });

    const customer = makeCustomer("cust-log-fail");
    const legacy = getCustomerScores(
      customer,
      { hasFollowUp: false },
      DEFAULT_SETTINGS,
      FIXED_NOW,
    );
    const seed = sampledSeed("log-fail");

    assert.doesNotThrow(() => {
      for (let index = 0; index < SHADOW_CUSTOMERS_EMIT_THRESHOLD; index += 1) {
        maybeRunStateV2ShadowBatch({
          requestSeed: seed,
          route: "list",
          settings: DEFAULT_SETTINGS,
          now: FIXED_NOW,
          customers: [{ customer, legacyScores: legacy, hasFollowUp: false }],
        });
      }
    });

    const snapshot = getShadowTelemetrySnapshot();
    assert.equal(snapshot.customersCompared, SHADOW_CUSTOMERS_EMIT_THRESHOLD);
  });
});
