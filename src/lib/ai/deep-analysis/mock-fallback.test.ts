import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCustomerAiInsightDisplayMeta,
} from "@/lib/ai/customer-insights/service";
import {
  isMockDeepInsight,
  isValidDeepInsight,
  resolveDeepAnalysisAvailability,
} from "@/lib/ai/deep-analysis/availability";
import { MOCK_CUSTOMER_INSIGHT_MODEL } from "@/lib/ai/providers/mock-constants";
import { getSafeAiRefreshErrorMessage } from "@/lib/ai/customer-insights/error-mapping";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import type { User } from "../../../../drizzle/schema/users";

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
    aiStaffFollowUpOrganizationEnabled: true,
    aiStaffDailyLimit: 3,
    ...overrides,
  };
}

function adminUser(): User {
  return {
    id: "admin-1",
    email: "admin@example.com",
    passwordHash: "x",
    displayName: "Admin",
    role: "admin",
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
  };
}

describe("Phase 4B mock / fallback production safety", () => {
  it("does not treat mock insights as displayable deep analysis", () => {
    const mock = { status: "ready" as const, model: MOCK_CUSTOMER_INSIGHT_MODEL };
    assert.equal(isMockDeepInsight(mock), true);
    assert.equal(isValidDeepInsight(mock), false);
  });

  it("marks global-disabled and mock-only as non-generatable", () => {
    const globalOff = resolveDeepAnalysisAvailability({
      user: adminUser(),
      settings: baseSettings({ aiEnabled: false, aiProvider: "mock" }),
      staffUsage: null,
      insight: null,
      providerConfigured: false,
      allowMockGeneration: false,
    });
    assert.equal(globalOff.reason, "GLOBAL_DISABLED");
    assert.equal(globalOff.canGenerate, false);

    const mockOnly = resolveDeepAnalysisAvailability({
      user: adminUser(),
      settings: baseSettings({ aiProvider: "mock" }),
      staffUsage: null,
      insight: { status: "ready", model: MOCK_CUSTOMER_INSIGHT_MODEL },
      providerConfigured: true,
      allowMockGeneration: false,
    });
    assert.equal(mockOnly.reason, "MOCK_ONLY");
    assert.equal(mockOnly.canGenerate, false);
    assert.equal(mockOnly.hasCachedInsight, false);
  });

  it("keeps cached real deep insight visible when provider is unavailable", () => {
    const result = resolveDeepAnalysisAvailability({
      user: adminUser(),
      settings: baseSettings(),
      staffUsage: null,
      insight: { status: "ready", model: "gemini-2.0-flash" },
      providerConfigured: false,
      allowMockGeneration: false,
    });
    assert.equal(result.reason, "PROVIDER_UNAVAILABLE");
    assert.equal(result.canGenerate, false);
    assert.equal(result.canViewCached, true);
    assert.equal(result.hasCachedInsight, true);
  });

  it("uses safe fallback messages without provider internals", () => {
    for (const code of [
      "AI_DEEP_ANALYSIS_GLOBAL_DISABLED",
      "AI_DEEP_ANALYSIS_MOCK_ONLY",
      "AI_PROVIDER_TEMPORARILY_UNAVAILABLE",
      "AI_ANALYSIS_FAILED",
    ] as const) {
      const message = getSafeAiRefreshErrorMessage(code);
      assert.ok(message.includes("基礎礎系統分析") || message.length > 0);
      assert.equal(message.includes("API_KEY"), false);
      assert.equal(message.includes("stack"), false);
      assert.equal(message.toLowerCase().includes("gemini"), false);
    }
  });

  it("display meta blocks refresh for mock and global-off without availability override", () => {
    assert.equal(
      getCustomerAiInsightDisplayMeta(
        adminUser(),
        baseSettings({ aiEnabled: false }),
      ).canRefresh,
      false,
    );
    assert.equal(
      getCustomerAiInsightDisplayMeta(
        adminUser(),
        baseSettings({ aiProvider: "mock" }),
      ).refreshDisabledReason,
      "mock_only",
    );
  });
});
