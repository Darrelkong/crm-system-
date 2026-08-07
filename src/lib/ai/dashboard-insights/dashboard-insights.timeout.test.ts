import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AI_SETTING_DEFAULTS } from "@/lib/settings/ai-keys";
import { parseEffectiveAiSettings } from "@/lib/settings/ai-effective";
import { resolveDashboardAiProviderConfig } from "./provider";

function baseSettings(
  overrides: Partial<Record<keyof typeof AI_SETTING_DEFAULTS, string>> = {},
) {
  return { ...AI_SETTING_DEFAULTS, ...overrides };
}

describe("dashboard AI timeout configuration", () => {
  it("uses ai_timeout_ms default from ai-keys when setting is missing", () => {
    const effective = parseEffectiveAiSettings(baseSettings());
    assert.equal(
      effective.aiTimeoutMs,
      Number(AI_SETTING_DEFAULTS.ai_timeout_ms),
    );
    assert.equal(effective.aiTimeoutMs, 30_000);
  });

  it("passes effective aiTimeoutMs through provider config", () => {
    const effective = parseEffectiveAiSettings(
      baseSettings({
        ai_enabled: "true",
        ai_provider: "google_gemini",
        ai_timeout_ms: "45000",
      }),
    );
    const config = resolveDashboardAiProviderConfig(effective, "test-key");
    assert.equal(config.timeoutMs, 45_000);
  });

  it("clamps ai_timeout_ms to the supported 5s–60s range", () => {
    const tooLow = parseEffectiveAiSettings(
      baseSettings({ ai_timeout_ms: "1000" }),
    );
    const tooHigh = parseEffectiveAiSettings(
      baseSettings({ ai_timeout_ms: "120000" }),
    );
    assert.equal(tooLow.aiTimeoutMs, 5_000);
    assert.equal(tooHigh.aiTimeoutMs, 60_000);
  });
});
