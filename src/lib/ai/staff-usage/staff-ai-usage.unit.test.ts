import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAiSettingValue } from "@/lib/settings/ai-validation";
import {
  computeRemaining,
  getHongKongUsageDate,
} from "@/lib/ai/staff-usage/service";
import { getCustomerAiInsightDisplayMeta } from "@/lib/ai/customer-insights/service";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import type { User } from "../../../../drizzle/schema/users";
import {
  resolveAiRefreshErrorCode,
  getSafeAiRefreshErrorMessage,
} from "@/lib/ai/customer-insights/error-mapping";
import { StaffAiQuotaError } from "@/lib/ai/staff-usage/service";
import {
  AiStaffDailyLimitReachedError,
  AiStaffDeepAnalysisDisabledError,
} from "@/lib/ai/customer-insights/errors";

function baseSettings(
  overrides: Partial<EffectiveAiSettings> = {},
): EffectiveAiSettings {
  return {
    aiEnabled: true,
    aiProvider: "google_gemini",
    aiApiBaseUrl: "https://generativelanguage.googleapis.com",
    aiApiBaseUrlValid: true,
    aiModel: "gemini-2.0-flash",
    aiTemperature: 0.2,
    aiMaxTokens: 1200,
    aiTimeoutMs: 30000,
    aiAnalysisLanguage: "zh-Hant",
    aiPromptTemplate: "template",
    aiPromptVersion: "v1",
    aiShowDraftMessage: true,
    aiStaffManualRefreshEnabled: true,
    aiAdminOnlyManualRefresh: false,
    aiStaffDeepAnalysisEnabled: true,
    aiStaffDailyLimit: 3,
    ...overrides,
  };
}

function staffUser(overrides: Partial<User> = {}): User {
  return {
    id: "staff-1",
    email: "staff@example.com",
    passwordHash: "x",
    displayName: "Staff One",
    role: "staff",
    isActive: 1,
    mustChangePassword: 0,
    passwordChangedAt: null,
    passwordResetAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    initialDeviceAutoApprovalEligible: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("staff AI settings validation", () => {
  it("accepts boolean staff deep analysis flag", () => {
    assert.equal(
      validateAiSettingValue("ai_staff_deep_analysis_enabled", "true"),
      null,
    );
    assert.equal(
      validateAiSettingValue("ai_staff_deep_analysis_enabled", "false"),
      null,
    );
  });

  it("rejects invalid daily limits", () => {
    assert.ok(validateAiSettingValue("ai_staff_daily_limit", "0"));
    assert.ok(validateAiSettingValue("ai_staff_daily_limit", "-1"));
    assert.ok(validateAiSettingValue("ai_staff_daily_limit", "1.5"));
    assert.ok(validateAiSettingValue("ai_staff_daily_limit", "101"));
    assert.ok(validateAiSettingValue("ai_staff_daily_limit", "NaN"));
  });

  it("accepts valid daily limits including presets", () => {
    for (const value of ["1", "3", "5", "10", "100"]) {
      assert.equal(validateAiSettingValue("ai_staff_daily_limit", value), null);
    }
  });
});

describe("Hong Kong usage date boundary", () => {
  it("uses Asia/Hong_Kong calendar day, not UTC date", () => {
    // 2026-07-19 23:30 HKT = 2026-07-19 15:30 UTC
    assert.equal(
      getHongKongUsageDate(new Date("2026-07-19T15:30:00.000Z")),
      "2026-07-19",
    );
    // 2026-07-20 00:00 HKT = 2026-07-19 16:00 UTC
    assert.equal(
      getHongKongUsageDate(new Date("2026-07-19T16:00:00.000Z")),
      "2026-07-20",
    );
    // Just before midnight HKT
    assert.equal(
      getHongKongUsageDate(new Date("2026-07-19T15:59:00.000Z")),
      "2026-07-19",
    );
  });
});

describe("computeRemaining", () => {
  it("clamps remaining to zero when used exceeds limit", () => {
    assert.equal(computeRemaining(0, 3), 3);
    assert.equal(computeRemaining(3, 3), 0);
    assert.equal(computeRemaining(5, 3), 0);
  });
});

describe("staff AI display meta", () => {
  it("blocks staff external refresh when deep analysis disabled", () => {
    const meta = getCustomerAiInsightDisplayMeta(
      staffUser(),
      baseSettings({ aiStaffDeepAnalysisEnabled: false }),
      {
        usageDate: "2026-07-20",
        enabled: false,
        dailyLimit: 3,
        used: 0,
        remaining: 0,
        denialReason: "staff_deep_analysis_disabled",
      },
    );
    assert.equal(meta.canRefresh, false);
    assert.equal(meta.refreshDisabledReason, "staff_deep_analysis_disabled");
  });

  it("blocks staff external refresh when daily limit reached", () => {
    const meta = getCustomerAiInsightDisplayMeta(
      staffUser(),
      baseSettings(),
      {
        usageDate: "2026-07-20",
        enabled: true,
        dailyLimit: 3,
        used: 3,
        remaining: 0,
        denialReason: "daily_limit_reached",
      },
    );
    assert.equal(meta.canRefresh, false);
    assert.equal(meta.refreshDisabledReason, "daily_limit_reached");
  });

  it("allows staff mock path even when deep analysis disabled", () => {
    const meta = getCustomerAiInsightDisplayMeta(
      staffUser(),
      baseSettings({
        aiEnabled: false,
        aiProvider: "mock",
        aiStaffDeepAnalysisEnabled: false,
      }),
      {
        usageDate: "2026-07-20",
        enabled: false,
        dailyLimit: 3,
        used: 0,
        remaining: 0,
        denialReason: "global_disabled",
      },
    );
    assert.equal(meta.canRefresh, true);
    assert.equal(meta.refreshDisabledReason, null);
  });

  it("does not attach staffUsage for admin", () => {
    const meta = getCustomerAiInsightDisplayMeta(
      staffUser({ role: "admin", id: "admin-1" }),
      baseSettings(),
      {
        usageDate: "2026-07-20",
        enabled: true,
        dailyLimit: 3,
        used: 0,
        remaining: 3,
        denialReason: null,
      },
    );
    assert.equal(meta.staffUsage, null);
  });
});

describe("staff AI error mapping", () => {
  it("maps quota errors safely", () => {
    assert.equal(
      resolveAiRefreshErrorCode(new AiStaffDeepAnalysisDisabledError()),
      "AI_STAFF_DEEP_ANALYSIS_DISABLED",
    );
    assert.equal(
      resolveAiRefreshErrorCode(new AiStaffDailyLimitReachedError()),
      "AI_STAFF_DAILY_LIMIT_REACHED",
    );
    assert.equal(
      resolveAiRefreshErrorCode(
        new StaffAiQuotaError(
          "AI_STAFF_DAILY_LIMIT_REACHED",
          "今日 AI 深度分析次数已用完",
        ),
      ),
      "AI_STAFF_DAILY_LIMIT_REACHED",
    );
    assert.equal(
      getSafeAiRefreshErrorMessage("AI_STAFF_DEEP_ANALYSIS_DISABLED"),
      "管理員目前未開放員工 AI 深度分析。",
    );
    assert.equal(
      getSafeAiRefreshErrorMessage("AI_STAFF_DAILY_LIMIT_REACHED"),
      "今日 AI 深度分析次數已用完。",
    );
  });
});
