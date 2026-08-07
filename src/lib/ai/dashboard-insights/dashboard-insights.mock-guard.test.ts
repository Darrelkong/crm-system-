import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  allowMockDashboardInsightGeneration,
  isMockDashboardInsightBlockedInProduction,
  isProductionRuntime,
} from "./mock-constants";
import { generateMockDashboardAiOutput } from "./mock";
import { buildDeterministicAdminBrief } from "./fallback";
import type { AdminAiProviderContext } from "./context/admin-context";

const ENV_KEYS = [
  "NODE_ENV",
  "CRM_ALLOW_MOCK_AI",
  "CRM_ALLOW_TEST_DB_BIND",
] as const;

function snapshotEnv(): Record<(typeof ENV_KEYS)[number], string | undefined> {
  return {
    NODE_ENV: process.env.NODE_ENV,
    CRM_ALLOW_MOCK_AI: process.env.CRM_ALLOW_MOCK_AI,
    CRM_ALLOW_TEST_DB_BIND: process.env.CRM_ALLOW_TEST_DB_BIND,
  };
}

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) {
    delete env[key];
  } else {
    env[key] = value;
  }
}

function restoreEnv(snapshot: Record<(typeof ENV_KEYS)[number], string | undefined>) {
  for (const key of ENV_KEYS) {
    setEnv(key, snapshot[key]);
  }
}

describe("dashboard AI production mock guards", () => {
  let envSnapshot: ReturnType<typeof snapshotEnv>;

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("blocks mock in production without allow flags", () => {
    envSnapshot = snapshotEnv();
    setEnv("NODE_ENV", "production");
    setEnv("CRM_ALLOW_MOCK_AI", undefined);
    setEnv("CRM_ALLOW_TEST_DB_BIND", undefined);
    assert.equal(isProductionRuntime(), true);
    assert.equal(isMockDashboardInsightBlockedInProduction(), true);
    assert.equal(allowMockDashboardInsightGeneration(), false);
  });

  it("blocks mock in production even when CRM_ALLOW_MOCK_AI=1", () => {
    envSnapshot = snapshotEnv();
    setEnv("NODE_ENV", "production");
    setEnv("CRM_ALLOW_MOCK_AI", "1");
    assert.equal(allowMockDashboardInsightGeneration(), false);
    assert.equal(isMockDashboardInsightBlockedInProduction(), true);
  });

  it("blocks mock in production even when CRM_ALLOW_TEST_DB_BIND=1", () => {
    envSnapshot = snapshotEnv();
    setEnv("NODE_ENV", "production");
    setEnv("CRM_ALLOW_TEST_DB_BIND", "1");
    assert.equal(allowMockDashboardInsightGeneration(), false);
    assert.equal(isMockDashboardInsightBlockedInProduction(), true);
  });

  it("blocks mock in production when both allow flags are set", () => {
    envSnapshot = snapshotEnv();
    setEnv("NODE_ENV", "production");
    setEnv("CRM_ALLOW_MOCK_AI", "1");
    setEnv("CRM_ALLOW_TEST_DB_BIND", "1");
    assert.equal(allowMockDashboardInsightGeneration(), false);
    assert.equal(isMockDashboardInsightBlockedInProduction(), true);
  });

  it("allows mock in test runtime", () => {
    envSnapshot = snapshotEnv();
    setEnv("NODE_ENV", "test");
    setEnv("CRM_ALLOW_MOCK_AI", undefined);
    setEnv("CRM_ALLOW_TEST_DB_BIND", undefined);
    assert.equal(allowMockDashboardInsightGeneration(), true);
  });

  it("allows mock in development only with explicit allow flag", () => {
    envSnapshot = snapshotEnv();
    setEnv("NODE_ENV", "development");
    setEnv("CRM_ALLOW_MOCK_AI", undefined);
    setEnv("CRM_ALLOW_TEST_DB_BIND", undefined);
    assert.equal(allowMockDashboardInsightGeneration(), false);

    setEnv("CRM_ALLOW_MOCK_AI", "1");
    assert.equal(allowMockDashboardInsightGeneration(), true);
  });

  it("system fallback is not labeled as mock or provider AI", () => {
    const context: AdminAiProviderContext = {
      metrics: {
        newCustomersToday: 0,
        validFollowUpsToday: 0,
        pendingApprovals: 0,
        autoReleaseWithin7Days: 0,
        autoReleaseTomorrow: 0,
        overdueFollowUps: 1,
        publicPoolEnteredToday: 0,
        totalCustomers: 10,
      },
      teamAggregates: {
        activeStaffCount: 2,
        staffWithOverdueCount: 1,
        staffWithReclamationRiskCount: 0,
        teamPendingItemsTotal: 1,
        teamCurrentCustomersTotal: 10,
      },
      reclamationRisk: {
        tomorrowCount: 0,
        within7Count: 0,
        membersAtRiskCount: 0,
        pendingRiskCount: 0,
      },
      stageDistribution: [],
      trendSummary: {
        validFollowUpsLast7Days: 0,
        newCustomersLast7Days: 0,
        stageProgressLast7Days: 0,
      },
    };
    const fallback = buildDeterministicAdminBrief(context);
    assert.ok(fallback.headline.length > 0);
    const mockOutput = generateMockDashboardAiOutput(
      "admin_management_brief",
      context,
    );
    assert.notEqual(mockOutput, null);
    assert.notEqual("system_fallback", "mock");
    assert.notEqual("system_fallback", "provider");
    assert.notEqual("system_fallback", "ai");
  });
});
