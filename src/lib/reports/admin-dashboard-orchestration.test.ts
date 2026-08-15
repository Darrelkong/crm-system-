import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { loadAdminDashboardReports } from "./admin-dashboard-orchestration";
import type { AdminDashboardReclamationData } from "./admin-dashboard-request-data";
import type { SharedAdminDashboardKpis, SharedAdminDashboardKpisInput } from "./admin-dashboard-shared-kpis";
import type { DashboardSummary } from "./dashboard-summary-types";
import type { AdminDashboardStats } from "./types";
import type { DashboardTrendsPayload } from "./dashboard-trends-types";
import type { DashboardStageDistributionPayload } from "./dashboard-stage-distribution-types";
import type { AdminTeamExecutionOverview } from "./admin-team-execution";
import type { User } from "../../../drizzle/schema/users";

const mockDb = {} as never;
const admin = { id: "admin-1", role: "admin", displayName: "Admin" } as User;
const now = new Date("2026-08-08T12:00:00.000Z");

const mockSettings = {
  automaticReclaimDays: 30,
  businessTimezone: "Asia/Hong_Kong",
} as EffectiveSettings;

const mockSummary = {
  role: "admin",
  metrics: {},
  reclamationRisk: {},
} as unknown as DashboardSummary;

const mockStats = {} as AdminDashboardStats;
const mockTrends = {} as DashboardTrendsPayload;
const mockStage = {} as DashboardStageDistributionPayload;
const mockSharedKpis = {
  totalCustomers: 42,
  pendingApprovals: 3,
} as SharedAdminDashboardKpis;
const mockTeam = {} as AdminTeamExecutionOverview;

function defer<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function withMockSharedKpis(
  hooks: Parameters<typeof loadAdminDashboardReports>[3],
) {
  return {
    loadSharedKpis: async () => mockSharedKpis,
    ...hooks,
  };
}

describe("admin dashboard orchestration", () => {
  it("starts trends and stage before reclamation completes", async () => {
    const events: string[] = [];
    const reclamationGate = defer<void>();

    const loadPromise = loadAdminDashboardReports(
      mockDb,
      admin,
      now,
      withMockSharedKpis({
      loadSettings: async () => {
        events.push("settings-done");
        return mockSettings;
      },
      loadReclamation: async () => {
        events.push("reclamation-start");
        await reclamationGate.promise;
        events.push("reclamation-done");
        return { reclamationSnapshots: [] };
      },
      getTrends: async () => {
        events.push("trends");
        return mockTrends;
      },
      getStage: async () => {
        events.push("stage");
        return mockStage;
      },
      getStats: async () => {
        events.push("legacy-stats");
        return mockStats;
      },
      getSummary: async () => {
        events.push("summary");
        return mockSummary;
      },
      getTeam: async () => {
        events.push("team");
        return mockTeam;
      },
      }),
    );

    await yieldToEventLoop();

    assert.ok(events.includes("trends"), "trends should start immediately");
    assert.ok(events.includes("stage"), "stage should start immediately");
    assert.ok(events.includes("settings-done"));
    assert.ok(events.includes("legacy-stats"));
    assert.ok(events.includes("reclamation-start"));
    assert.equal(events.includes("summary"), false);
    assert.equal(events.includes("team"), false);
    assert.equal(events.includes("reclamation-done"), false);

    reclamationGate.resolve();
    await loadPromise;

    assert.ok(events.includes("summary"));
    assert.ok(events.includes("team"));
    assert.ok(
      events.indexOf("trends") < events.indexOf("reclamation-done"),
      "trends should complete before reclamation",
    );
    assert.ok(
      events.indexOf("legacy-stats") < events.indexOf("summary"),
      "legacy stats should not wait for reclamation summary chain",
    );
  });

  it("keeps trends, stage, and legacy stats independent when reclamation fails", async () => {
    const events: string[] = [];

    const result = await loadAdminDashboardReports(
      mockDb,
      admin,
      now,
      withMockSharedKpis({
      loadSettings: async () => mockSettings,
      loadReclamation: async () => {
        events.push("reclamation-failed");
        return { reclamationSnapshotsFailed: true };
      },
      getTrends: async () => {
        events.push("trends");
        return mockTrends;
      },
      getStage: async () => {
        events.push("stage");
        return mockStage;
      },
      getStats: async () => {
        events.push("legacy-stats");
        return mockStats;
      },
      getSummary: async () => mockSummary,
      getTeam: async () => {
        throw new Error("reclamation snapshots unavailable");
      },
      }),
    );

    assert.deepEqual(events.sort(), [
      "legacy-stats",
      "reclamation-failed",
      "stage",
      "trends",
    ]);
    assert.equal(result.trendsResult.error, false);
    assert.equal(result.stageResult.error, false);
    assert.equal(result.teamResult.error, true);
    assert.equal(result.summary.role, "admin");
  });

  it("keeps trends, stage, and legacy stats independent when reclamation hangs then resolves", async () => {
    const events: string[] = [];
    const reclamationGate = defer<AdminDashboardReclamationData>();

    const loadPromise = loadAdminDashboardReports(
      mockDb,
      admin,
      now,
      withMockSharedKpis({
      loadSettings: async () => mockSettings,
      loadReclamation: async () => {
        events.push("reclamation-start");
        return reclamationGate.promise;
      },
      getTrends: async () => {
        events.push("trends");
        return mockTrends;
      },
      getStage: async () => {
        events.push("stage");
        return mockStage;
      },
      getStats: async () => {
        events.push("legacy-stats");
        return mockStats;
      },
      getSummary: async () => mockSummary,
      getTeam: async () => mockTeam,
      }),
    );

    await yieldToEventLoop();

    assert.deepEqual(events.sort(), [
      "legacy-stats",
      "reclamation-start",
      "stage",
      "trends",
    ]);

    reclamationGate.resolve({ reclamationSnapshots: [] });
    const result = await loadPromise;

    assert.equal(result.trendsResult.error, false);
    assert.equal(result.stageResult.error, false);
    assert.equal(result.teamResult.error, false);
  });

  it("loads shared KPIs once and passes the same promise to legacy stats and summary", async () => {
    let sharedKpiLoads = 0;
    let sharedKpisPromise: Promise<SharedAdminDashboardKpis> | undefined;
    let statsSharedKpis: SharedAdminDashboardKpisInput | undefined;
    let summarySharedKpis: SharedAdminDashboardKpisInput | undefined;

    await loadAdminDashboardReports(mockDb, admin, now, {
      loadSettings: async () => mockSettings,
      loadSharedKpis: () => {
        sharedKpiLoads += 1;
        sharedKpisPromise ??= Promise.resolve(mockSharedKpis);
        return sharedKpisPromise;
      },
      loadReclamation: async () => ({ reclamationSnapshots: [] }),
      getTrends: async () => mockTrends,
      getStage: async () => mockStage,
      getStats: async (_db, _now, options) => {
        statsSharedKpis = options?.sharedKpis;
        return mockStats;
      },
      getSummary: async (_db, _user, _now, options) => {
        summarySharedKpis = options?.sharedKpis;
        return mockSummary;
      },
      getTeam: async () => mockTeam,
    });

    assert.equal(sharedKpiLoads, 1);
    assert.ok(sharedKpisPromise);
    assert.strictEqual(statsSharedKpis, sharedKpisPromise);
    assert.strictEqual(summarySharedKpis, sharedKpisPromise);
    assert.deepEqual(await statsSharedKpis, mockSharedKpis);
    assert.deepEqual(await summarySharedKpis, mockSharedKpis);
  });

  it("starts reclamation without waiting for shared KPI resolution", async () => {
    const events: string[] = [];
    const sharedKpiGate = defer<SharedAdminDashboardKpis>();

    const loadPromise = loadAdminDashboardReports(mockDb, admin, now, {
      loadSettings: async () => {
        events.push("settings-done");
        return mockSettings;
      },
      loadSharedKpis: async () => {
        events.push("shared-kpis-start");
        const result = await sharedKpiGate.promise;
        events.push("shared-kpis-done");
        return result;
      },
      loadReclamation: async () => {
        events.push("reclamation-start");
        return { reclamationSnapshots: [] };
      },
      getTrends: async () => mockTrends,
      getStage: async () => mockStage,
      getStats: async () => {
        events.push("legacy-stats");
        return mockStats;
      },
      getSummary: async () => mockSummary,
      getTeam: async () => mockTeam,
    });

    await yieldToEventLoop();

    assert.ok(events.includes("settings-done"));
    assert.ok(events.includes("shared-kpis-start"));
    assert.ok(events.includes("reclamation-start"));
    assert.ok(events.includes("legacy-stats"));
    assert.equal(events.includes("shared-kpis-done"), false);
    assert.ok(
      events.indexOf("reclamation-start") < events.indexOf("shared-kpis-done") ||
        events.indexOf("shared-kpis-done") === -1,
    );

    sharedKpiGate.resolve(mockSharedKpis);
    await loadPromise;

    assert.ok(events.includes("shared-kpis-done"));
    assert.ok(
      events.indexOf("reclamation-start") < events.indexOf("shared-kpis-done"),
      "reclamation should start before shared KPIs finish",
    );
  });
});
