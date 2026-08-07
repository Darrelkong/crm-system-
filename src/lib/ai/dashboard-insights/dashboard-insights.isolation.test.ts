import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("dashboard failure isolation wiring", () => {
  it("dashboard server views do not await dashboard AI service", () => {
    for (const file of [
      "src/components/dashboard/staff-dashboard-view.tsx",
      "src/components/dashboard/admin-dashboard-view.tsx",
      "src/lib/reports/dashboard-summary.ts",
      "src/lib/reports/dashboard-trends.ts",
      "src/lib/reports/dashboard-stage-distribution.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /generateDashboardAiInsight/);
      assert.doesNotMatch(source, /from ["']@\/lib\/ai\/dashboard-insights/);
    }
  });

  it("AI card loads asynchronously via API and keeps KPI services independent", () => {
    const card = readFileSync(
      "src/components/dashboard/dashboard-ai-insight-card.tsx",
      "utf8",
    );
    assert.match(card, /fetch\(`\/api\/dashboard\/ai-insight/);
    assert.doesNotMatch(card, /getDashboardSummary/);
    assert.doesNotMatch(card, /getDashboardTrends/);

    const staffView = readFileSync(
      "src/components/dashboard/staff-dashboard-view.tsx",
      "utf8",
    );
    const adminView = readFileSync(
      "src/components/dashboard/admin-dashboard-view.tsx",
      "utf8",
    );
    assert.match(staffView, /getDashboardSummary/);
    assert.match(adminView, /getDashboardSummary/);
    assert.match(staffView, /DashboardAiInsightCard/);
    assert.match(adminView, /DashboardAiInsightCard/);
  });

  it("documents production mock guard in mock constants", () => {
    const source = readFileSync(
      "src/lib/ai/dashboard-insights/mock-constants.ts",
      "utf8",
    );
    assert.match(source, /isProductionRuntime/);
    assert.match(source, /allowMockDashboardInsightGeneration/);
    assert.match(source, /isMockDashboardInsightBlockedInProduction/);
  });
});
