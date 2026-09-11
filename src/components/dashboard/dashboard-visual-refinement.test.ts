import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("dashboard visual refinement", () => {
  it("replaces admin source and sales stage bar lists with compact visualizations", () => {
    const adminClient = readFileSync(
      "src/components/dashboard/admin-dashboard-client.tsx",
      "utf8",
    );

    assert.match(adminClient, /DashboardSourceDistributionDonut/);
    assert.match(adminClient, /DashboardSalesStageOverview/);
    assert.doesNotMatch(adminClient, /SimpleBarRow/);
    assert.doesNotMatch(
      readFileSync(
        "src/components/dashboard/dashboard-source-distribution-donut.tsx",
        "utf8",
      ),
      /grid-cols-1 gap-2 sm:flex-1/,
    );
  });

  it("keeps stage distribution card compact with expandable full stage access", () => {
    const stageCard = readFileSync(
      "src/components/dashboard/dashboard-stage-distribution-card.tsx",
      "utf8",
    );

    assert.match(stageCard, /grid grid-cols-2 gap-2/);
    assert.match(stageCard, /viewAllStages/);
    assert.match(stageCard, /expanded \? distribution\.stages : nonZeroStages/);
  });
});
