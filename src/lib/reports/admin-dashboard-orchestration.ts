import type { Database } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { getAdminDashboardStats } from "./admin-dashboard";
import {
  loadAdminDashboardReclamationData,
  loadAdminDashboardSharedSettings,
  type AdminDashboardReclamationData,
} from "./admin-dashboard-request-data";
import { getAdminTeamExecutionOverview } from "./admin-team-execution";
import { getDashboardSummary } from "./dashboard-summary";
import { getDashboardStageDistribution } from "./dashboard-stage-distribution";
import { getDashboardTrends } from "./dashboard-trends";
import type { AdminDashboardStats } from "./types";
import type { AdminTeamExecutionOverview } from "./admin-team-execution";
import type { AdminDashboardSummary } from "./dashboard-summary-types";
import type { DashboardTrendsPayload } from "./dashboard-trends-types";
import type { DashboardStageDistributionPayload } from "./dashboard-stage-distribution-types";

export type AdminDashboardTrendsResult =
  | { trends: DashboardTrendsPayload; error: false }
  | { trends: null; error: true };

export type AdminDashboardStageResult =
  | { distribution: DashboardStageDistributionPayload; error: false }
  | { distribution: null; error: true };

export type AdminDashboardTeamResult =
  | { overview: AdminTeamExecutionOverview; error: false }
  | { overview: null; error: true };

export type AdminDashboardOrchestrationResult = {
  summary: AdminDashboardSummary;
  legacyStats: AdminDashboardStats;
  trendsResult: AdminDashboardTrendsResult;
  stageResult: AdminDashboardStageResult;
  teamResult: AdminDashboardTeamResult;
};

export type AdminDashboardOrchestrationHooks = {
  loadSettings?: (db: Database) => Promise<EffectiveSettings>;
  loadReclamation?: (
    db: Database,
    now: Date,
    settings: EffectiveSettings,
  ) => Promise<AdminDashboardReclamationData>;
  getTrends?: typeof getDashboardTrends;
  getStage?: typeof getDashboardStageDistribution;
  getStats?: typeof getAdminDashboardStats;
  getSummary?: typeof getDashboardSummary;
  getTeam?: typeof getAdminTeamExecutionOverview;
};

export async function loadAdminDashboardReports(
  db: Database,
  user: User,
  now: Date = new Date(),
  hooks: AdminDashboardOrchestrationHooks = {},
): Promise<AdminDashboardOrchestrationResult> {
  const loadSettings = hooks.loadSettings ?? loadAdminDashboardSharedSettings;
  const loadReclamation =
    hooks.loadReclamation ?? loadAdminDashboardReclamationData;
  const getTrends = hooks.getTrends ?? getDashboardTrends;
  const getStage = hooks.getStage ?? getDashboardStageDistribution;
  const getStats = hooks.getStats ?? getAdminDashboardStats;
  const getSummary = hooks.getSummary ?? getDashboardSummary;
  const getTeam = hooks.getTeam ?? getAdminTeamExecutionOverview;

  const trendsPromise: Promise<AdminDashboardTrendsResult> = getTrends(
    db,
    user,
    now,
  )
    .then((trends) => ({ trends, error: false as const }))
    .catch(() => ({ trends: null, error: true as const }));

  const stagePromise: Promise<AdminDashboardStageResult> = getStage(db, user)
    .then((distribution) => ({ distribution, error: false as const }))
    .catch(() => ({ distribution: null, error: true as const }));

  const settings = await loadSettings(db);

  const legacyStatsPromise = getStats(db, now, { settings });

  const reclamationPromise = loadReclamation(db, now, settings);

  const summaryPromise = reclamationPromise.then((reclamationData) =>
    getSummary(db, user, now, {
      settings,
      ...reclamationData,
    }),
  );

  const teamPromise = reclamationPromise
    .then((reclamationData) =>
      getTeam(db, user, now, {
        settings,
        ...reclamationData,
      }).then((overview) => ({ overview, error: false as const })),
    )
    .catch(() => ({ overview: null, error: true as const }));

  const [summary, legacyStats, trendsResult, stageResult, teamResult] =
    await Promise.all([
      summaryPromise,
      legacyStatsPromise,
      trendsPromise,
      stagePromise,
      teamPromise,
    ]);

  if (summary.role !== "admin") {
    throw new Error("Expected admin dashboard summary");
  }

  return {
    summary,
    legacyStats,
    trendsResult,
    stageResult,
    teamResult,
  };
}
