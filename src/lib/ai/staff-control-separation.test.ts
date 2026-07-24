import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEffectiveAiSettings } from "@/lib/settings/ai-effective";
import { AI_SETTING_DEFAULTS, type AiSettingKey } from "@/lib/settings/ai-keys";
import { resolveDeepAnalysisAvailability } from "@/lib/ai/deep-analysis/availability";
import type { User } from "../../../drizzle/schema/users";
import type { AiSettingsMap } from "@/lib/settings/ai-service";

function rawSettings(overrides: Partial<Record<AiSettingKey, string>> = {}) {
  return {
    ...AI_SETTING_DEFAULTS,
    ai_enabled: "true",
    ai_provider: "google_gemini",
    ...overrides,
  } as AiSettingsMap;
}

function staff(): User {
  return {
    id: "staff-1",
    role: "staff",
    email: "s@example.com",
    displayName: "Staff",
  } as User;
}

describe("AI control separation settings", () => {
  it("defaults follow-up organization to false when key missing", () => {
    const map = { ...AI_SETTING_DEFAULTS } as Record<string, string>;
    delete map.ai_staff_follow_up_organization_enabled;
    const parsed = parseEffectiveAiSettings(map as AiSettingsMap);
    assert.equal(parsed.aiStaffFollowUpOrganizationEnabled, false);
  });

  it("parses true/false independently from deep analysis", () => {
    const deepOnly = parseEffectiveAiSettings(
      rawSettings({
        ai_staff_deep_analysis_enabled: "true",
        ai_staff_follow_up_organization_enabled: "false",
      }),
    );
    assert.equal(deepOnly.aiStaffDeepAnalysisEnabled, true);
    assert.equal(deepOnly.aiStaffFollowUpOrganizationEnabled, false);

    const orgOnly = parseEffectiveAiSettings(
      rawSettings({
        ai_staff_deep_analysis_enabled: "false",
        ai_staff_follow_up_organization_enabled: "true",
      }),
    );
    assert.equal(orgOnly.aiStaffDeepAnalysisEnabled, false);
    assert.equal(orgOnly.aiStaffFollowUpOrganizationEnabled, true);
  });
});

describe("independent staff gates for deep analysis", () => {
  const usage = {
    usageDate: "2026-07-20",
    enabled: true,
    anyStaffAiFeatureEnabled: true,
    deepAnalysisEnabled: true,
    followUpOrganizationEnabled: true,
    dailyLimit: 3,
    used: 0,
    remaining: 3,
    denialReason: null as null,
  };

  it("deep on / organizer off → deep available", () => {
    const settings = parseEffectiveAiSettings(
      rawSettings({
        ai_staff_deep_analysis_enabled: "true",
        ai_staff_follow_up_organization_enabled: "false",
      }),
    );
    const deep = resolveDeepAnalysisAvailability({
      user: staff(),
      settings,
      staffUsage: usage,
      insight: null,
      providerConfigured: true,
      allowMockGeneration: false,
    });
    assert.equal(deep.canGenerate, true);
    assert.equal(settings.aiStaffFollowUpOrganizationEnabled, false);
  });

  it("deep off / organizer on → deep blocked", () => {
    const settings = parseEffectiveAiSettings(
      rawSettings({
        ai_staff_deep_analysis_enabled: "false",
        ai_staff_follow_up_organization_enabled: "true",
      }),
    );
    const deep = resolveDeepAnalysisAvailability({
      user: staff(),
      settings,
      staffUsage: usage,
      insight: null,
      providerConfigured: true,
      allowMockGeneration: false,
    });
    assert.equal(deep.canGenerate, false);
    assert.equal(deep.reason, "STAFF_DISABLED");
    assert.equal(settings.aiStaffFollowUpOrganizationEnabled, true);
  });
});
