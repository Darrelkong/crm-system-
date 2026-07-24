import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMockDeepInsight,
  isValidDeepInsight,
  resolveDeepAnalysisAvailability,
} from "@/lib/ai/deep-analysis/availability";
import { deepAnalysisStatusMessageKey } from "@/lib/ai/deep-analysis/ui-messages";
import { MOCK_CUSTOMER_INSIGHT_MODEL } from "@/lib/ai/providers/mock-constants";
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

function readyInsight(model = "gemini-2.0-flash") {
  return { status: "ready", model };
}

function resolve(input: Parameters<typeof resolveDeepAnalysisAvailability>[0]) {
  return resolveDeepAnalysisAvailability({
    allowMockGeneration: false,
    ...input,
  });
}

describe("isValidDeepInsight / isMockDeepInsight", () => {
  it("rejects mock insights as valid deep analysis", () => {
    assert.equal(
      isMockDeepInsight({ status: "ready", model: MOCK_CUSTOMER_INSIGHT_MODEL }),
      true,
    );
    assert.equal(
      isValidDeepInsight({
        status: "ready",
        model: MOCK_CUSTOMER_INSIGHT_MODEL,
      }),
      false,
    );
  });

  it("accepts ready non-mock insights", () => {
    assert.equal(isValidDeepInsight(readyInsight()), true);
  });
});

describe("resolveDeepAnalysisAvailability", () => {
  it("allows staff when enabled with remaining quota", () => {
    const result = resolve({
      user: staffUser(),
      settings: baseSettings(),
      staffUsage: {
        usageDate: "2026-07-20",
        enabled: true,
        dailyLimit: 3,
        used: 1,
        remaining: 2,
        denialReason: null,
      },
      insight: readyInsight(),
      providerConfigured: true,
    });
    assert.equal(result.canGenerate, true);
    assert.equal(result.reason, "AVAILABLE");
    assert.equal(result.canViewCached, true);
    assert.equal(result.hasCachedInsight, true);
  });

  it("blocks staff when deep analysis disabled", () => {
    const result = resolve({
      user: staffUser(),
      settings: baseSettings({ aiStaffDeepAnalysisEnabled: false }),
      staffUsage: {
        usageDate: "2026-07-20",
        enabled: false,
        dailyLimit: 3,
        used: 0,
        remaining: 0,
        denialReason: "staff_deep_analysis_disabled",
      },
      insight: readyInsight(),
      providerConfigured: true,
    });
    assert.equal(result.canGenerate, false);
    assert.equal(result.reason, "STAFF_DISABLED");
    assert.equal(result.canViewCached, true);
  });

  it("blocks when daily limit reached but keeps cached view", () => {
    const result = resolve({
      user: staffUser(),
      settings: baseSettings(),
      staffUsage: {
        usageDate: "2026-07-20",
        enabled: true,
        dailyLimit: 3,
        used: 3,
        remaining: 0,
        denialReason: "daily_limit_reached",
      },
      insight: readyInsight(),
      providerConfigured: true,
    });
    assert.equal(result.canGenerate, false);
    assert.equal(result.reason, "LIMIT_REACHED");
    assert.equal(result.hasCachedInsight, true);
  });

  it("blocks when global AI disabled", () => {
    const result = resolve({
      user: staffUser(),
      settings: baseSettings({ aiEnabled: false, aiProvider: "mock" }),
      staffUsage: null,
      insight: null,
      providerConfigured: false,
    });
    assert.equal(result.canGenerate, false);
    assert.equal(result.reason, "GLOBAL_DISABLED");
  });

  it("treats mock provider as unavailable for production generate", () => {
    const result = resolve({
      user: staffUser(),
      settings: baseSettings({ aiProvider: "mock" }),
      staffUsage: {
        usageDate: "2026-07-20",
        enabled: true,
        dailyLimit: 3,
        used: 0,
        remaining: 3,
        denialReason: null,
      },
      insight: {
        status: "ready",
        model: MOCK_CUSTOMER_INSIGHT_MODEL,
      },
      providerConfigured: true,
    });
    assert.equal(result.canGenerate, false);
    assert.equal(result.reason, "MOCK_ONLY");
    assert.equal(result.hasCachedInsight, false);
    assert.equal(result.cachedIsMock, true);
  });

  it("blocks when provider key is missing", () => {
    const result = resolve({
      user: staffUser(),
      settings: baseSettings(),
      staffUsage: {
        usageDate: "2026-07-20",
        enabled: true,
        dailyLimit: 3,
        used: 0,
        remaining: 3,
        denialReason: null,
      },
      insight: null,
      providerConfigured: false,
    });
    assert.equal(result.reason, "PROVIDER_UNAVAILABLE");
    assert.equal(result.canGenerate, false);
  });

  it("exempts admin from staff quota gates", () => {
    const result = resolve({
      user: staffUser({ role: "admin", id: "admin-1" }),
      settings: baseSettings({
        aiStaffDeepAnalysisEnabled: false,
        aiStaffDailyLimit: 1,
      }),
      staffUsage: null,
      insight: readyInsight(),
      providerConfigured: true,
    });
    assert.equal(result.canGenerate, true);
    assert.equal(result.reason, "AVAILABLE");
    assert.equal(result.remaining, null);
  });

  it("still blocks admin when global AI is disabled", () => {
    const result = resolve({
      user: staffUser({ role: "admin", id: "admin-1" }),
      settings: baseSettings({ aiEnabled: false }),
      staffUsage: null,
      insight: readyInsight(),
      providerConfigured: true,
    });
    assert.equal(result.canGenerate, false);
    assert.equal(result.reason, "GLOBAL_DISABLED");
    assert.equal(result.canViewCached, true);
  });

  it("distinguishes cooldown from limit reached", () => {
    const result = resolve({
      user: staffUser(),
      settings: baseSettings(),
      staffUsage: {
        usageDate: "2026-07-20",
        enabled: true,
        dailyLimit: 3,
        used: 1,
        remaining: 2,
        denialReason: null,
      },
      insight: readyInsight(),
      providerConfigured: true,
      onCooldown: true,
    });
    assert.equal(result.reason, "COOLDOWN");
    assert.equal(result.canGenerate, false);
    assert.notEqual(result.reason, "LIMIT_REACHED");
  });

  it("supports cached insight when regenerate is blocked", () => {
    const result = resolve({
      user: staffUser(),
      settings: baseSettings({ aiStaffDeepAnalysisEnabled: false }),
      staffUsage: {
        usageDate: "2026-07-20",
        enabled: false,
        dailyLimit: 3,
        used: 0,
        remaining: 0,
        denialReason: "staff_deep_analysis_disabled",
      },
      insight: readyInsight(),
      providerConfigured: true,
    });
    assert.equal(result.canViewCached, true);
    assert.equal(result.canGenerate, false);
  });

  it("reports empty deep state when no cache and cannot generate", () => {
    const result = resolve({
      user: staffUser(),
      settings: baseSettings({ aiStaffDeepAnalysisEnabled: false }),
      staffUsage: {
        usageDate: "2026-07-20",
        enabled: false,
        dailyLimit: 3,
        used: 0,
        remaining: 0,
        denialReason: "staff_deep_analysis_disabled",
      },
      insight: null,
      providerConfigured: true,
    });
    assert.equal(result.hasCachedInsight, false);
    assert.equal(result.canGenerate, false);
  });

  it("blocks manual refresh disabled and admin-only", () => {
    assert.equal(
      resolve({
        user: staffUser(),
        settings: baseSettings({ aiStaffManualRefreshEnabled: false }),
        staffUsage: {
          usageDate: "2026-07-20",
          enabled: true,
          dailyLimit: 3,
          used: 0,
          remaining: 3,
          denialReason: null,
        },
        insight: null,
        providerConfigured: true,
      }).reason,
      "MANUAL_REFRESH_DISABLED",
    );
    assert.equal(
      resolve({
        user: staffUser(),
        settings: baseSettings({ aiAdminOnlyManualRefresh: true }),
        staffUsage: {
          usageDate: "2026-07-20",
          enabled: true,
          dailyLimit: 3,
          used: 0,
          remaining: 3,
          denialReason: null,
        },
        insight: null,
        providerConfigured: true,
      }).reason,
      "ADMIN_ONLY",
    );
  });

  it("applies deterministic reason priority for combined conditions", () => {
    assert.equal(
      resolve({
        user: staffUser(),
        settings: baseSettings({
          aiEnabled: false,
          aiStaffDeepAnalysisEnabled: false,
        }),
        staffUsage: {
          usageDate: "2026-07-20",
          enabled: false,
          dailyLimit: 3,
          used: 3,
          remaining: 0,
          denialReason: "staff_deep_analysis_disabled",
        },
        insight: readyInsight(),
        providerConfigured: true,
      }).reason,
      "GLOBAL_DISABLED",
    );

    assert.equal(
      resolve({
        user: staffUser(),
        settings: baseSettings({
          aiProvider: "mock",
          aiStaffDeepAnalysisEnabled: false,
        }),
        staffUsage: {
          usageDate: "2026-07-20",
          enabled: false,
          dailyLimit: 3,
          used: 0,
          remaining: 0,
          denialReason: "staff_deep_analysis_disabled",
        },
        insight: readyInsight(),
        providerConfigured: true,
      }).reason,
      "MOCK_ONLY",
    );

    assert.equal(
      resolve({
        user: staffUser(),
        settings: baseSettings({ aiStaffDeepAnalysisEnabled: false }),
        staffUsage: {
          usageDate: "2026-07-20",
          enabled: false,
          dailyLimit: 3,
          used: 3,
          remaining: 0,
          denialReason: "daily_limit_reached",
        },
        insight: readyInsight(),
        providerConfigured: true,
        onCooldown: true,
      }).reason,
      "STAFF_DISABLED",
    );

    const limitThenCooldown = resolve({
      user: staffUser(),
      settings: baseSettings(),
      staffUsage: {
        usageDate: "2026-07-20",
        enabled: true,
        dailyLimit: 3,
        used: 3,
        remaining: 0,
        denialReason: "daily_limit_reached",
      },
      insight: readyInsight(),
      providerConfigured: true,
      onCooldown: true,
    });
    assert.equal(limitThenCooldown.reason, "LIMIT_REACHED");
    assert.equal(limitThenCooldown.canViewCached, true);
  });

  it("keeps cached deep visible under global disabled and limit reached", () => {
    const globalCached = resolve({
      user: staffUser(),
      settings: baseSettings({ aiEnabled: false }),
      staffUsage: null,
      insight: readyInsight(),
      providerConfigured: false,
    });
    assert.equal(globalCached.canViewCached, true);
    assert.equal(globalCached.canGenerate, false);

    const limitCached = resolve({
      user: staffUser(),
      settings: baseSettings(),
      staffUsage: {
        usageDate: "2026-07-20",
        enabled: true,
        dailyLimit: 3,
        used: 3,
        remaining: 0,
        denialReason: "daily_limit_reached",
      },
      insight: readyInsight(),
      providerConfigured: true,
    });
    assert.equal(limitCached.canViewCached, true);
    assert.equal(limitCached.reason, "LIMIT_REACHED");
  });

  it("rejects legacy short mock model id as valid deep insight", () => {
    assert.equal(isMockDeepInsight({ status: "ready", model: "mock" }), true);
    assert.equal(isValidDeepInsight({ status: "ready", model: "mock" }), false);
  });
});

describe("deepAnalysisStatusMessageKey", () => {
  it("maps status reasons to i18n keys", () => {
    assert.equal(
      deepAnalysisStatusMessageKey("STAFF_DISABLED"),
      "customers.deepAnalysis.status.staffDisabled",
    );
    assert.equal(
      deepAnalysisStatusMessageKey("LIMIT_REACHED"),
      "customers.deepAnalysis.status.limitReached",
    );
    assert.equal(
      deepAnalysisStatusMessageKey("GLOBAL_DISABLED"),
      "customers.deepAnalysis.status.globalDisabled",
    );
    assert.equal(
      deepAnalysisStatusMessageKey("PROVIDER_UNAVAILABLE"),
      "customers.deepAnalysis.status.providerUnavailable",
    );
  });
});
