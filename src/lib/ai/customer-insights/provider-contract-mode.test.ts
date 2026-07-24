import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAiProviderPhase2ContractMode } from "@/lib/ai/customer-insights/provider-contract-mode";
import { buildSystemPrompt } from "@/lib/ai/customer-insights/prompt-builder";
import { parseCombinedCustomerInsightProviderOutput } from "@/lib/ai/customer-insights/phase2-parse";

const baseOutput = {
  intentLevel: "medium" as const,
  intentScore: 50,
  customerSummary: "s",
  currentSituation: "c",
  keySignals: [] as string[],
  riskFlags: [] as string[],
  missingInformation: [] as string[],
  nextBestAction: "a",
  suggestedFollowUpAt: null,
  suggestedEmployeeMessage: "您好，想确认一下资料准备进度。",
  confidence: 0.5,
  reasoning: "r",
};

describe("provider Phase 2 contract mode (server-only)", () => {
  it("maps known providers exactly (case-sensitive)", () => {
    assert.equal(resolveAiProviderPhase2ContractMode("google_gemini"), "gemini_flat");
    assert.equal(resolveAiProviderPhase2ContractMode("openai_compatible"), "rich");
    assert.equal(resolveAiProviderPhase2ContractMode("mock"), "none");
  });

  it("unknown / mistyped provider kinds fall back to none (never rich)", () => {
    for (const kind of [
      "GOOGLE_GEMINI",
      "Google_Gemini",
      "openai",
      "gemini",
      "",
      "unknown_vendor",
    ]) {
      assert.equal(resolveAiProviderPhase2ContractMode(kind), "none", kind);
    }
  });

  it("prompt modes stay aligned with server provider mapping", () => {
    const geminiPrompt = buildSystemPrompt("zh-Hans", {
      phase2ContractMode: resolveAiProviderPhase2ContractMode("google_gemini"),
    });
    assert.match(geminiPrompt, /phase2SignalRows/);
    assert.doesNotMatch(geminiPrompt, /optional top-level key phase2Signals/);

    const openaiPrompt = buildSystemPrompt("zh-Hans", {
      phase2ContractMode: resolveAiProviderPhase2ContractMode("openai_compatible"),
    });
    assert.match(openaiPrompt, /phase2Signals/);
    assert.doesNotMatch(openaiPrompt, /phase2SignalRows/);

    const mockPrompt = buildSystemPrompt("zh-Hans", {
      phase2ContractMode: resolveAiProviderPhase2ContractMode("mock"),
    });
    assert.doesNotMatch(mockPrompt, /phase2SignalRows/);
    assert.doesNotMatch(mockPrompt, /optional top-level key phase2Signals/);
  });

  it("client payload cannot inject contract mode into parser", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        // Forged client field — must be rejected as unknown top-level, not honored.
        phase2ContractMode: "rich",
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, false);
    if (parsed.success) return;
    assert.equal(parsed.reason, "unknown_top_level_field");
    assert.equal(parsed.field, "phase2ContractMode");
  });
});
