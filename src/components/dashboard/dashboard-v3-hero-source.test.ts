import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("dashboard v3 hero and source donut", () => {
  it("uses left-aligned hero actions with primary/secondary button hierarchy", () => {
    const actions = readFileSync(
      "src/components/dashboard/dashboard-header-actions.tsx",
      "utf8",
    );

    assert.match(actions, /inline-flex/);
    assert.doesNotMatch(actions, /justify-end/);
    assert.doesNotMatch(actions, /grid-cols-2/);
    assert.doesNotMatch(actions, /from-indigo-600 to-violet-700/);
    assert.match(actions, /bg-indigo-50\/90/);
    assert.match(actions, /text-indigo-700/);
    assert.match(actions, /href="\/customers\/new"/);
    assert.match(actions, /href="\/knowledge"/);
  });

  it("implements an interactive source donut without a permanent legend list", () => {
    const donut = readFileSync(
      "src/components/dashboard/dashboard-source-distribution-donut.tsx",
      "utf8",
    );

    assert.match(donut, /DashboardSourceDetailSheet/);
    assert.match(donut, /sourceDistributionTapHint/);
    assert.match(donut, /sourceDistributionViewDetails/);
    assert.match(donut, /selectedKey/);
    assert.match(donut, /describeDonutSegment/);
    assert.doesNotMatch(donut, /grid-cols-1 gap-2 sm:flex-1/);
    assert.match(donut, /sourceDistributionOther/);
    assert.match(donut, /__aggregated_other__/);
  });
});
