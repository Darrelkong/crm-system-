import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("dashboard drill-down semantics", () => {
  it("keeps exact valid follow-up links in summary clients", () => {
    const adminSummary = read(
      "src/components/dashboard/admin-dashboard-summary-client.tsx",
    );
    const staffSummary = read(
      "src/components/dashboard/staff-dashboard-summary-client.tsx",
    );

    assert.match(adminSummary, /buildValidFollowUpsTodayHref/);
    assert.match(staffSummary, /buildValidFollowUpsTodayHref/);
    assert.match(adminSummary, /validFollowUpsToday > 0/);
    assert.match(staffSummary, /validFollowUpsToday > 0/);
  });

  it("removes inexact reclamation links from summary KPI cards", () => {
    const adminSummary = read(
      "src/components/dashboard/admin-dashboard-summary-client.tsx",
    );
    const staffSummary = read(
      "src/components/dashboard/staff-dashboard-summary-client.tsx",
    );

    assert.doesNotMatch(adminSummary, /reclamationRisk=team/);
    assert.doesNotMatch(staffSummary, /reclamationRisk=mine/);
    assert.match(adminSummary, /autoReleaseWithin7Days/);
    assert.match(adminSummary, /autoReleaseTomorrow/);
    assert.match(staffSummary, /autoReleaseWithin7Days/);
    assert.match(staffSummary, /autoReleaseTomorrow/);
  });

  it("removes team auto-release reclamation href wiring", () => {
    const teamCard = read("src/components/dashboard/admin-team-execution-card.tsx");
    const teamExecution = read("src/lib/reports/admin-team-execution.ts");
    const drilldownLinks = read("src/lib/reports/dashboard-drilldown-links.ts");

    assert.doesNotMatch(teamCard, /reclamationHref/);
    assert.doesNotMatch(teamExecution, /reclamationHref/);
    assert.doesNotMatch(drilldownLinks, /buildTeamReclamationHref/);
    assert.match(teamCard, /buildTeamValidFollowUpsHref/);
    assert.match(teamCard, /member\.customersHref/);
    assert.match(teamCard, /member\.overdueHref/);
  });
});
