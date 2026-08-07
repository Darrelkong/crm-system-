import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import en from "@/i18n/locales/en";

const AI_KEYS = [
  "aiTodaySuggestions",
  "aiManagementBrief",
  "aiSourceProvider",
  "aiSourceSystemFallback",
  "aiSourceMock",
  "aiRefresh",
  "aiGeneratingSuggestions",
  "aiGeneratingBrief",
  "aiUnavailable",
  "aiTimeout",
  "aiInvalidResponse",
  "aiDisabled",
  "aiRateLimited",
  "aiViewCustomer",
  "aiGoToItem",
  "aiManagementPriorities",
  "aiCautions",
] as const;

describe("dashboard AI card wiring", () => {
  it("defines AI i18n keys in all locales", () => {
    for (const key of AI_KEYS) {
      assert.ok(
        (zhHans.dashboard as Record<string, unknown>)[key],
        `zh-Hans missing ${key}`,
      );
      assert.ok(
        (zhHant.dashboard as Record<string, unknown>)[key],
        `zh-Hant missing ${key}`,
      );
      assert.ok(
        (en.dashboard as Record<string, unknown>)[key],
        `en missing ${key}`,
      );
    }
    assert.equal(en.dashboard.aiSourceSystemFallback, "Based on system data");
    assert.equal(zhHans.dashboard.aiSourceSystemFallback, "基于系统数据");
    assert.equal(zhHant.dashboard.aiSourceSystemFallback, "基於系統資料");
    assert.equal(en.dashboard.aiSourceMock, "Mock AI data");
    assert.notEqual(en.dashboard.aiSourceSystemFallback, en.dashboard.aiSourceProvider);
  });

  it("places AI cards after summary and before blocking KPI reloads", () => {
    const staffView = readFileSync(
      "src/components/dashboard/staff-dashboard-view.tsx",
      "utf8",
    );
    const adminView = readFileSync(
      "src/components/dashboard/admin-dashboard-view.tsx",
      "utf8",
    );
    assert.match(staffView, /DashboardAiInsightCard variant="staff"/);
    assert.match(adminView, /DashboardAiInsightCard variant="admin"/);
    assert.ok(
      staffView.indexOf("StaffDashboardSummaryClient") <
        staffView.indexOf("DashboardAiInsightCard"),
    );
    assert.ok(
      adminView.indexOf("AdminDashboardSummaryClient") <
        adminView.indexOf("DashboardAiInsightCard"),
    );
    assert.doesNotMatch(staffView, /generateDashboardAiInsight/);
    assert.doesNotMatch(adminView, /generateDashboardAiInsight/);
    assert.doesNotMatch(staffView, /await\s+.*[Aa]i[Ii]nsight/);
    assert.doesNotMatch(adminView, /await\s+.*[Aa]i[Ii]nsight/);
  });

  it("AI card uses client fetch and safe text rendering", () => {
    const card = readFileSync(
      "src/components/dashboard/dashboard-ai-insight-card.tsx",
      "utf8",
    );
    assert.match(card, /"use client"/);
    assert.match(card, /\/api\/dashboard\/ai-insight/);
    assert.match(card, /params\.set\("forceRefresh", "1"\)/);
    assert.doesNotMatch(card, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(card, /react-markdown|Markdown/);
    assert.match(card, /aiSourceSystemFallback/);
    assert.match(card, /aiSourceMock/);
    assert.match(card, /aiSourceProvider/);
    assert.match(card, /min-h-11/);
    assert.match(card, /break-words/);
    assert.doesNotMatch(card, /iPhone|iPad/);
    assert.doesNotMatch(card, /setInterval/);
  });

  it("staff card does not show admin AI settings link markup for staff variant only", () => {
    const card = readFileSync(
      "src/components/dashboard/dashboard-ai-insight-card.tsx",
      "utf8",
    );
    assert.match(card, /variant === "admin"/);
    assert.match(card, /\/admin\/ai-settings/);
  });

  it("admin card does not build ranking UI", () => {
    const card = readFileSync(
      "src/components/dashboard/dashboard-ai-insight-card.tsx",
      "utf8",
    );
    assert.doesNotMatch(card, /ranking|leaderboard|Top Staff|销售冠军/i);
  });
});
