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
  "stageDistributionPrivateActiveCustomers",
  "stageDistributionMyPrivateActiveCustomers",
  "stageDistributionScopeHint",
  "totalClients",
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
    assert.match(card, /stageDistributionPrivateActiveCustomers/);
    assert.match(card, /stageDistributionMyPrivateActiveCustomers/);
    assert.match(card, /stageDistributionScopeHint/);
    assert.match(card, /break-words/);
    assert.doesNotMatch(card, /setInterval|requestAnimationFrame/);
    assert.doesNotMatch(card, /私有活跃客户|Active private customers/);
  });

  it("admin stage distribution uses private customer scope helper", () => {
    const stageService = readFileSync(
      "src/lib/reports/dashboard-stage-distribution.ts",
      "utf8",
    );
    const scopes = readFileSync(
      "src/lib/reports/dashboard-customer-scopes.ts",
      "utf8",
    );
    const ownerHelper = readFileSync(
      "src/lib/customers/valid-internal-customer-owner.ts",
      "utf8",
    );
    assert.match(stageService, /adminStageDistributionWhere/);
    assert.match(scopes, /validInternalCustomerOwnerExistsSql/);
    assert.match(ownerHelper, /is_active = 1/);
    assert.match(ownerHelper, /role IN \('staff', 'admin'\)/);
    assert.doesNotMatch(stageService, /u\.role = 'staff'/);
  });

  it("distinguishes all-customers KPI from private-active stage totals", () => {
    assert.equal(zhHans.dashboard.totalClients, "全部客户");
    assert.equal(zhHant.dashboard.totalClients, "全部客戶");
    assert.equal(en.dashboard.totalClients, "All customers");
    assert.match(
      zhHans.dashboard.stageDistributionPrivateActiveCustomers,
      /私有活跃客户/,
    );
    assert.match(
      zhHant.dashboard.stageDistributionPrivateActiveCustomers,
      /私人活躍客戶/,
    );
    assert.match(
      en.dashboard.stageDistributionPrivateActiveCustomers,
      /Active private customers/,
    );
    assert.match(
      zhHans.dashboard.stageDistributionScopeHint,
      /有效内部成员/,
    );
    assert.match(
      zhHant.dashboard.stageDistributionScopeHint,
      /有效內部成員/,
    );
    assert.match(
      en.dashboard.stageDistributionScopeHint,
      /valid internal team members/,
    );
  });
});
