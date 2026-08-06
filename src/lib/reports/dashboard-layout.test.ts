import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("dashboard layout and performance wiring", () => {
  it("uses a single dashboard summary service per view", () => {
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
    assert.doesNotMatch(staffView, /fetch\(/);
    assert.doesNotMatch(adminView, /fetch\(/);
  });

  it("places notifications and announcements below summary cards", () => {
    const staffView = readFileSync(
      "src/components/dashboard/staff-dashboard-view.tsx",
      "utf8",
    );
    const staffSummaryPos = staffView.indexOf("StaffDashboardSummaryClient");
    const notificationsPos = staffView.indexOf("RecentNotificationsCard");
    assert.ok(staffSummaryPos >= 0);
    assert.ok(notificationsPos > staffSummaryPos);
  });

  it("uses responsive grids without device-name hardcoding", () => {
    const staffClient = readFileSync(
      "src/components/dashboard/staff-dashboard-summary-client.tsx",
      "utf8",
    );
    assert.match(staffClient, /sm:grid-cols-2/);
    assert.match(staffClient, /lg:grid-cols/);
    assert.doesNotMatch(staffClient, /iPhone|iPad/);
    assert.doesNotMatch(staffClient, /setInterval|setTimeout/);
  });

  it("does not expose leaderboard fields in dashboard summary types", () => {
    const types = readFileSync(
      "src/lib/reports/dashboard-summary-types.ts",
      "utf8",
    );
    assert.doesNotMatch(types, /ranking|leaderboard|排行/i);
  });

  it("reads settings once in dashboard summary service", () => {
    const service = readFileSync(
      "src/lib/reports/dashboard-summary.ts",
      "utf8",
    );
    const settingsCalls = service.match(/await getEffectiveSettings\(/g) ?? [];
    assert.equal(settingsCalls.length, 1);
  });
});
