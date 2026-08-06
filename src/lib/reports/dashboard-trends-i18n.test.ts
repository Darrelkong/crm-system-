import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import {
  ADMIN_TREND_METRICS,
  STAFF_TREND_METRICS,
  UNAVAILABLE_TREND_METRICS,
} from "./dashboard-trends-types";

const KEYS = [
  "trendOverview",
  "trendRange7",
  "trendRange30",
  "trendRange90",
  "trendMetricValidFollowUps",
  "trendMetricNewCustomers",
  "trendMetricEnteredNegotiation",
  "trendMetricClosedWon",
  "trendMetricReleasedToPool",
  "trendMetricClaimedFromPool",
  "trendCurrentPeriod",
  "trendPreviousPeriod",
  "trendIncreased",
  "trendDecreased",
  "trendFlat",
  "trendNewThisPeriod",
  "trendEmptyPeriod",
  "trendUnavailable",
] as const;

describe("dashboard trends i18n and wiring", () => {
  it("defines trend keys in three locales", () => {
    for (const key of KEYS) {
      assert.ok(zhHans.dashboard[key], `zh-Hans missing ${key}`);
      assert.ok(zhHant.dashboard[key], `zh-Hant missing ${key}`);
      assert.ok(en.dashboard[key], `en missing ${key}`);
    }
  });

  it("staff and admin available metrics exclude pending second conversion", () => {
    assert.ok(UNAVAILABLE_TREND_METRICS.includes("pending_second_conversion"));
    const staffKeys = STAFF_TREND_METRICS.map((m) => m.key as string);
    const adminKeys = ADMIN_TREND_METRICS.map((m) => m.key as string);
    assert.equal(staffKeys.includes("pending_second_conversion"), false);
    assert.equal(adminKeys.includes("pending_second_conversion"), false);
  });

  it("defaults staff to valid follow-ups and admin to new customers", () => {
    assert.equal(STAFF_TREND_METRICS[0]?.key, "valid_follow_ups");
    assert.equal(ADMIN_TREND_METRICS[0]?.key, "new_customers");
  });

  it("trend card uses SVG without chart libraries or timers", () => {
    const card = readFileSync(
      "src/components/dashboard/dashboard-trends-card.tsx",
      "utf8",
    );
    assert.match(card, /<svg/);
    assert.doesNotMatch(card, /recharts|chart\.js|echarts|visx/i);
    assert.doesNotMatch(card, /setInterval|requestAnimationFrame/);
    assert.match(card, /aria-pressed/);
    assert.match(card, /dashboard\.trend/);
    assert.doesNotMatch(card, /RankingTable|排行榜|Top Staff/);
  });

  it("dashboard views load trends without blocking summary failure isolation", () => {
    const staff = readFileSync(
      "src/components/dashboard/staff-dashboard-view.tsx",
      "utf8",
    );
    const admin = readFileSync(
      "src/components/dashboard/admin-dashboard-view.tsx",
      "utf8",
    );
    assert.match(staff, /getDashboardTrends/);
    assert.match(admin, /getDashboardTrends/);
    assert.match(staff, /DashboardTrendsCard/);
    assert.match(admin, /DashboardTrendsCard/);
  });

  it("trend service aggregates by HK day without per-staff loops", () => {
    const service = readFileSync(
      "src/lib/reports/dashboard-trends.ts",
      "utf8",
    );
    assert.match(service, /strftime\('%Y-%m-%d'/);
    assert.match(service, /groupBy/);
    assert.doesNotMatch(service, /for \(const staff/);
    assert.match(service, /isValidFollowUp/);
    assert.match(service, /createdBy/);
    assert.match(service, /claimed_from_pool/);
    assert.match(service, /field_change_logs|fieldChangeLogs/);
  });
});
