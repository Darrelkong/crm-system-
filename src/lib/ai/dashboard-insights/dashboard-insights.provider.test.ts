import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { callDashboardAiProvider } from "./provider";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";

const settings = {
  aiAnalysisLanguage: "en",
} as EffectiveAiSettings;

describe("dashboard AI provider errors", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    mock.restoreAll();
  });

  it("maps HTTP 503 to unavailable", async () => {
    global.fetch = mock.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const result = await callDashboardAiProvider(
      {
        providerKind: "google_gemini",
        apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.0-flash",
        temperature: 0.2,
        maxTokens: 800,
        timeoutMs: 1000,
        apiKey: "test-key",
      },
      settings,
      "admin_management_brief",
      { metrics: { overdueFollowUps: 1 } },
    );
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.category, "unavailable");
  });

  it("maps abort/timeout to timeout", async () => {
    global.fetch = mock.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    }) as unknown as typeof fetch;

    const result = await callDashboardAiProvider(
      {
        providerKind: "openai_compatible",
        apiBaseUrl: "https://api.openai.com",
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 800,
        timeoutMs: 1000,
        apiKey: "test-key",
      },
      settings,
      "staff_today_actions",
      { metrics: { overdueFollowUps: 0 } },
    );
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.category, "timeout");
  });
});
