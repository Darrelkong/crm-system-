import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getAdminDashboardStats } from "./admin-dashboard";
import {
  getAdminDashboardRequestInstrumentation,
  resetAdminDashboardRequestInstrumentation,
} from "./admin-dashboard-request-instrumentation";
import { loadAdminDashboardRequestData } from "./admin-dashboard-request-data";
import { loadAdminDashboardReports } from "./admin-dashboard-orchestration";
import { getAdminTeamExecutionOverview } from "./admin-team-execution";
import { getDashboardSummary } from "./dashboard-summary";
import { getBusinessTodayRange } from "./dates";
import type { User } from "../../../drizzle/schema/users";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const admin = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

const FIXED_NOW = new Date("2026-08-08T12:00:00.000Z");

const KPI_TEST_CUSTOMER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01";
const KPI_TEST_ARCHIVED = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02";
const KPI_TEST_DELETED = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03";
const KPI_TEST_APPROVAL_A = "cccccccc-cccc-cccc-cccc-cccccccccc01";
const KPI_TEST_APPROVAL_B = "cccccccc-cccc-cccc-cccc-cccccccccc02";

async function cleanupKpiTestRows(): Promise<void> {
  for (const id of [KPI_TEST_APPROVAL_A, KPI_TEST_APPROVAL_B]) {
    await db.delete(schema.approvals).where(eq(schema.approvals.id, id));
  }
  for (const id of [KPI_TEST_CUSTOMER, KPI_TEST_ARCHIVED, KPI_TEST_DELETED]) {
    await db.delete(schema.customers).where(eq(schema.customers.id, id));
  }
}

async function insertKpiTestCustomer(
  id: string,
  overrides: Partial<typeof schema.customers.$inferInsert> = {},
): Promise<void> {
  const nowIso = FIXED_NOW.toISOString();
  await db.insert(schema.customers).values({
    id,
    customerName: `[TEST KPI] ${id.slice(-4)}`,
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: `1380000${id.slice(-4)}`,
    source: "referral",
    salesStage: "lead",
    ownerId: SEED_IDS.staffA,
    status: "active",
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    isPinned: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...overrides,
  });
}

async function insertKpiTestApproval(id: string): Promise<void> {
  const nowIso = FIXED_NOW.toISOString();
  await db.insert(schema.approvals).values({
    id,
    requestType: "delete_customer",
    status: "pending",
    customerId: KPI_TEST_CUSTOMER,
    requestedBy: SEED_IDS.staffA,
    reason: "[TEST KPI] pending approval",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

async function upsertSetting(key: string, value: string): Promise<void> {
  const existing = await db
    .select({ key: schema.systemSettings.key })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  const updatedAt = new Date().toISOString();
  if (existing.length > 0) {
    await db
      .update(schema.systemSettings)
      .set({ value, updatedAt })
      .where(eq(schema.systemSettings.key, key));
  } else {
    await db.insert(schema.systemSettings).values({ key, value, updatedAt });
  }
}

async function readAutomaticReclaimDays(): Promise<number> {
  const row = await db
    .select({ value: schema.systemSettings.value })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, "automatic_reclaim_days"))
    .limit(1);
  return Number(row[0]?.value ?? 0);
}

async function runLegacyAdminDashboardLoads(now: Date) {
  resetAdminDashboardRequestInstrumentation();
  const [summary, legacyStats, teamOverview] = await Promise.all([
    getDashboardSummary(db, admin, now),
    getAdminDashboardStats(db, now),
    getAdminTeamExecutionOverview(db, admin, now),
  ]);
  return { summary, legacyStats, teamOverview };
}

async function runSharedAdminDashboardLoads(now: Date) {
  resetAdminDashboardRequestInstrumentation();
  const result = await loadAdminDashboardReports(db, admin, now);
  return {
    summary: result.summary,
    legacyStats: result.legacyStats,
    teamOverview: result.teamResult.overview,
  };
}

describe("admin dashboard request dedup DB", () => {
  let originalAutomaticReclaimDays: string | null = null;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;

    const row = await db
      .select({ value: schema.systemSettings.value })
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "automatic_reclaim_days"))
      .limit(1);
    originalAutomaticReclaimDays = row[0]?.value ?? null;
  });

  after(async () => {
    if (originalAutomaticReclaimDays !== null) {
      await upsertSetting(
        "automatic_reclaim_days",
        originalAutomaticReclaimDays,
      );
    }
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("legacy admin dashboard path loads settings 3x and reclamation snapshots 2x", async () => {
    await runLegacyAdminDashboardLoads(FIXED_NOW);
    const instrumentation = getAdminDashboardRequestInstrumentation();
    assert.equal(instrumentation.settingsPhysicalLoads, 3);
    assert.equal(instrumentation.reclamationSnapshotPhysicalLoads, 2);
    assert.equal(instrumentation.sharedKpiPhysicalLoads, 0);
    assert.equal(instrumentation.totalCustomersPhysicalLoads, 2);
    assert.equal(instrumentation.pendingApprovalsPhysicalLoads, 2);
  });

  it("shared admin dashboard request data loads settings and snapshots once", async () => {
    await runSharedAdminDashboardLoads(FIXED_NOW);
    const instrumentation = getAdminDashboardRequestInstrumentation();
    assert.equal(instrumentation.settingsPhysicalLoads, 1);
    assert.equal(instrumentation.reclamationSnapshotPhysicalLoads, 1);
    assert.equal(instrumentation.sharedKpiPhysicalLoads, 1);
    assert.equal(instrumentation.totalCustomersPhysicalLoads, 1);
    assert.equal(instrumentation.pendingApprovalsPhysicalLoads, 1);
  });

  it("shared KPI totals match between legacy stats and summary metrics", async () => {
    const shared = await runSharedAdminDashboardLoads(FIXED_NOW);
    assert.equal(shared.summary.role, "admin");
    assert.equal(
      shared.legacyStats.totalCustomers,
      shared.summary.metrics.totalCustomers,
    );
    assert.equal(
      shared.legacyStats.pendingApprovals,
      shared.summary.metrics.pendingApprovals,
    );
  });

  it("matches admin summary metrics between legacy and shared request data", async () => {
    const legacy = await runLegacyAdminDashboardLoads(FIXED_NOW);
    const shared = await runSharedAdminDashboardLoads(FIXED_NOW);
    assert.equal(legacy.summary.role, "admin");
    assert.equal(shared.summary.role, "admin");
    assert.deepEqual(shared.summary.metrics, legacy.summary.metrics);
    assert.deepEqual(shared.summary.reclamationRisk, legacy.summary.reclamationRisk);
  });

  it("matches legacy admin stats between legacy and shared request data", async () => {
    const legacy = await runLegacyAdminDashboardLoads(FIXED_NOW);
    const shared = await runSharedAdminDashboardLoads(FIXED_NOW);
    assert.deepEqual(shared.legacyStats, legacy.legacyStats);
  });

  it("matches team execution overview between legacy and shared request data", async () => {
    const legacy = await runLegacyAdminDashboardLoads(FIXED_NOW);
    const shared = await runSharedAdminDashboardLoads(FIXED_NOW);
    assert.deepEqual(shared.teamOverview, legacy.teamOverview);
  });

  it("reads fresh settings on each request without cross-request stale cache", async () => {
    await upsertSetting("automatic_reclaim_days", "45");
    const requestA = await loadAdminDashboardRequestData(db, FIXED_NOW);
    assert.equal(requestA.settings.automaticReclaimDays, 45);

    await upsertSetting("automatic_reclaim_days", "60");
    const requestB = await loadAdminDashboardRequestData(db, FIXED_NOW);
    assert.equal(requestB.settings.automaticReclaimDays, 60);
    assert.notEqual(
      requestA.settings.automaticReclaimDays,
      requestB.settings.automaticReclaimDays,
    );

    const stored = await readAutomaticReclaimDays();
    assert.equal(stored, 60);
  });

  it("keeps timezone on shared admin dashboard settings", async () => {
    const requestData = await loadAdminDashboardRequestData(db, FIXED_NOW);
    const { start } = getBusinessTodayRange(
      requestData.now,
      requestData.settings.businessTimezone,
    );
    assert.match(start, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(requestData.settings.businessTimezone, "Asia/Hong_Kong");
  });

  it("isolates reclamation failure: summary empty risk, team execution errors", async () => {
    const requestData = await loadAdminDashboardRequestData(db, FIXED_NOW);
    const summary = await getDashboardSummary(db, admin, FIXED_NOW, {
      settings: requestData.settings,
      reclamationSnapshotsFailed: true,
    });
    assert.equal(summary.role, "admin");
    assert.equal(summary.reclamationRisk.tomorrowCount, 0);
    assert.equal(summary.reclamationRisk.within7Count, 0);
    assert.equal(summary.reclamationRisk.within14Count, 0);
    assert.equal(summary.metrics.autoReleaseTomorrow, 0);
    assert.equal(summary.metrics.autoReleaseWithin7Days, 0);
    assert.ok(typeof summary.metrics.totalCustomers === "number");

    await assert.rejects(
      () =>
        getAdminTeamExecutionOverview(db, admin, FIXED_NOW, {
          settings: requestData.settings,
          reclamationSnapshotsFailed: true,
        }),
      /reclamation snapshots unavailable/,
    );
  });

  it("excludes archived customers from shared totalCustomers identically in stats and summary", async () => {
    await cleanupKpiTestRows();
    const baseline = await runSharedAdminDashboardLoads(FIXED_NOW);
    await insertKpiTestCustomer(KPI_TEST_ARCHIVED, { status: "archived" });
    const withArchived = await runSharedAdminDashboardLoads(FIXED_NOW);
    assert.equal(
      withArchived.legacyStats.totalCustomers,
      baseline.legacyStats.totalCustomers,
    );
    assert.equal(
      withArchived.summary.metrics.totalCustomers,
      baseline.summary.metrics.totalCustomers,
    );
    await cleanupKpiTestRows();
  });

  it("includes soft-deleted non-archived customers in totalCustomers identically", async () => {
    await cleanupKpiTestRows();
    const baseline = await runSharedAdminDashboardLoads(FIXED_NOW);
    await insertKpiTestCustomer(KPI_TEST_DELETED, {
      deletedAt: FIXED_NOW.toISOString(),
    });
    const withDeleted = await runSharedAdminDashboardLoads(FIXED_NOW);
    assert.equal(
      withDeleted.legacyStats.totalCustomers,
      baseline.legacyStats.totalCustomers + 1,
    );
    assert.equal(
      withDeleted.summary.metrics.totalCustomers,
      withDeleted.legacyStats.totalCustomers,
    );
    await cleanupKpiTestRows();
  });

  it("counts multiple pending approvals identically in stats and summary", async () => {
    await cleanupKpiTestRows();
    await insertKpiTestCustomer(KPI_TEST_CUSTOMER);
    const baseline = await runSharedAdminDashboardLoads(FIXED_NOW);
    await insertKpiTestApproval(KPI_TEST_APPROVAL_A);
    await insertKpiTestApproval(KPI_TEST_APPROVAL_B);
    const withApprovals = await runSharedAdminDashboardLoads(FIXED_NOW);
    assert.equal(
      withApprovals.legacyStats.pendingApprovals,
      baseline.legacyStats.pendingApprovals + 2,
    );
    assert.equal(
      withApprovals.summary.metrics.pendingApprovals,
      withApprovals.legacyStats.pendingApprovals,
    );
    await cleanupKpiTestRows();
  });
});
