import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import en from "@/i18n/locales/en";

const KEYS = [
  "dueTodayFollowUps",
  "overdueFollowUps",
  "autoReleaseWithin7Days",
  "autoReleaseTomorrow",
  "pendingWorkItems",
  "validFollowUpsToday",
  "newCustomersToday",
  "publicPoolEnteredToday",
  "customerReclamationRisk",
  "teamCustomerReclamationRisk",
  "viewRelatedCustomers",
  "noReclamationRisk",
  "todayManagementPriorities",
  "recentNotifications",
  "latestAnnouncements",
] as const;

describe("dashboard summary i18n", () => {
  it("defines dashboard keys in zh-Hans, zh-Hant, and en", () => {
    for (const key of KEYS) {
      assert.ok(zhHans.dashboard[key], `zh-Hans missing dashboard.${key}`);
      assert.ok(zhHant.dashboard[key], `zh-Hant missing dashboard.${key}`);
      assert.ok(en.dashboard[key], `en missing dashboard.${key}`);
    }
  });

  it("dashboard summary clients avoid hardcoded metric labels", () => {
    for (const file of [
      "src/components/dashboard/staff-dashboard-summary-client.tsx",
      "src/components/dashboard/admin-dashboard-summary-client.tsx",
      "src/components/dashboard/dashboard-reclamation-risk-card.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /dashboard\./);
      assert.doesNotMatch(source, /今日应跟进|Due today/);
    }
  });
});
