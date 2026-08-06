import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const KEYS = [
  "stageDistributionTitle",
  "teamStageDistribution",
  "myStageDistribution",
  "stageDistributionEmpty",
  "stageDistributionUnavailable",
  "stageNotSet",
  "stageOther",
  "teamExecutionOverview",
  "teamExecutionReportingPeriod",
  "teamExecutionLast7Days",
  "teamExecutionLast30Days",
  "teamExecutionLast90Days",
  "teamExecutionPeriodActivity",
  "teamExecutionCurrentStatus",
  "teamExecutionMember",
  "teamExecutionCurrentCustomers",
  "teamExecutionValidFollowUps",
  "teamExecutionStageProgress",
  "teamExecutionOverdue",
  "teamExecutionAutoRelease7d",
  "teamExecutionPendingItems",
  "teamExecutionEmpty",
  "teamExecutionUnavailable",
  "teamExecutionViewCustomers",
] as const;

describe("dashboard phase 5C i18n and wiring", () => {
  it("defines phase 5C keys in three locales", () => {
    for (const key of KEYS) {
      assert.ok(zhHans.dashboard[key], `zh-Hans missing ${key}`);
      assert.ok(zhHant.dashboard[key], `zh-Hant missing ${key}`);
      assert.ok(en.dashboard[key], `en missing ${key}`);
    }
  });

  it("does not expose ranking fields or labels in phase 5C services", () => {
    const team = readFileSync(
      "src/lib/reports/admin-team-execution.ts",
      "utf8",
    );
    const stageCard = readFileSync(
      "src/components/dashboard/dashboard-stage-distribution-card.tsx",
      "utf8",
    );
    const teamCard = readFileSync(
      "src/components/dashboard/admin-team-execution-card.tsx",
      "utf8",
    );
    assert.doesNotMatch(team, /rank|position|score|leaderboard|排行榜|Top Staff/i);
    assert.doesNotMatch(teamCard, /rank|排行榜|冠军|Top Staff|RankingTable/i);
    assert.doesNotMatch(stageCard, /RankingTable|排行榜|orderBy\(desc\(count/);
    assert.match(team, /sortTeamMembersStable/);
    assert.match(team, /staffOwnedActiveCustomersBatchWhere/);
    assert.match(team, /getPendingActionCountsByUserIds/);
    assert.match(team, /groupBy/);
    assert.doesNotMatch(team, /for \(const staff of[\s\S]*await db/);
  });

  it("loads stage distribution for staff and team overview only for admin", () => {
    const staff = readFileSync(
      "src/components/dashboard/staff-dashboard-view.tsx",
      "utf8",
    );
    const admin = readFileSync(
      "src/components/dashboard/admin-dashboard-view.tsx",
      "utf8",
    );
    assert.match(staff, /getDashboardStageDistribution/);
    assert.match(staff, /DashboardStageDistributionCard/);
    assert.doesNotMatch(staff, /getAdminTeamExecutionOverview/);
    assert.doesNotMatch(staff, /AdminTeamExecutionCard/);
    assert.match(admin, /getAdminTeamExecutionOverview/);
    assert.match(admin, /AdminTeamExecutionCard/);
  });

  it("stage distribution card avoids hardcoded copy", () => {
    const card = readFileSync(
      "src/components/dashboard/dashboard-stage-distribution-card.tsx",
      "utf8",
    );
    assert.match(card, /dashboard\./);
    assert.doesNotMatch(card, /setInterval|requestAnimationFrame/);
  });

  it("admin stage distribution uses private customer scope helper", () => {
    const stageService = readFileSync(
      "src/lib/reports/dashboard-stage-distribution.ts",
      "utf8",
    );
    assert.match(stageService, /adminStageDistributionWhere/);
    assert.doesNotMatch(stageService, /u\.role = 'staff'/);
  });
});
