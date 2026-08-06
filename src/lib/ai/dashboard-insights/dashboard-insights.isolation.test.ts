import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("dashboard failure isolation wiring", () => {
  it("dashboard views do not import dashboard AI service", () => {
    for (const file of [
      "src/components/dashboard/staff-dashboard-view.tsx",
      "src/components/dashboard/admin-dashboard-view.tsx",
      "src/lib/reports/dashboard-summary.ts",
      "src/lib/reports/dashboard-trends.ts",
      "src/lib/reports/dashboard-stage-distribution.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /generateDashboardAiInsight/);
      assert.doesNotMatch(source, /dashboard-insights/);
    }
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
