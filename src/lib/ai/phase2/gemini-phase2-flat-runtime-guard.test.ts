/**
 * Proves Production Gemini runtime request remains Base-12-only after 5C-G1
 * candidate files land (candidate must not be imported by google-gemini.ts).
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA } from "@/lib/ai/customer-insights/json-schema";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import { googleGeminiCustomerInsightProvider } from "@/lib/ai/providers/google-gemini";

const runtimeConfig = {
  apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  model: "gemini-2.5-flash",
  apiKey: "test-key-not-real",
  temperature: 0.2,
  maxTokens: 2048,
  timeoutMs: 5000,
};

const settings = {
  aiEnabled: true,
  aiProvider: "google_gemini",
  aiModel: "gemini-2.5-flash",
  aiApiBaseUrl: runtimeConfig.apiBaseUrl,
  aiMaxTokens: 2048,
  aiTemperature: 0.2,
  aiTimeoutMs: 5000,
  aiAnalysisLanguage: "zh-Hans",
  aiPromptTemplate: "Analyze {{context_json}}",
  aiPromptVersion: "phase-1d-v1",
  aiAdminOnlyManualRefresh: true,
  aiStaffManualRefreshEnabled: false,
  aiStaffDailyLimit: 5,
  aiStaffDeepAnalysisEnabled: true,
  aiStaffFollowUpOrganizationEnabled: true,
} as unknown as EffectiveAiSettings;

const context = {
  customerId: "cust-fixture",
  customerName: "Fixture",
  customerType: "individual",
  salesStage: "new",
  source: "web",
  status: "active",
  requestedProjectName: null,
  sourceRemark: null,
  notes: "想了解流程",
  contactAvailability: {
    hasAnyContactMethod: true,
    hasWeChat: true,
    hasPhone: false,
    hasEmail: false,
  },
  lastFollowUpAt: null,
  lastValidFollowUpAt: null,
  nextFollowUpAt: null,
  updatedAt: "2026-07-24T00:00:00.000Z",
  recentFollowUps: [],
} as unknown as CustomerInsightContext;

const validInsightPayload = {
  intentLevel: "medium",
  intentScore: 50,
  customerSummary: "summary",
  currentSituation: "situation",
  keySignals: ["a"],
  riskFlags: [],
  missingInformation: [],
  nextBestAction: "follow up",
  suggestedFollowUpAt: null,
  suggestedEmployeeMessage: "您好，想跟进一下资料准备情况。",
  confidence: 0.5,
  reasoning: "reason",
};

function parseRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  assert.equal(typeof body, "string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

describe("Production Gemini runtime remains Base-12-only", () => {
  it("final request schema and prompt exclude Flat Phase 2 contract", async () => {
    let captured: Record<string, unknown> | undefined;
    const fetchMock = mock.fn(async (_url: unknown, init: unknown) => {
      captured = parseRequestBody(init as RequestInit);
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(validInsightPayload) }],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
      });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      await googleGeminiCustomerInsightProvider.analyzeCustomerInsight(
        context,
        settings,
        runtimeConfig,
      );
      assert.ok(captured);
      const body = captured;
      const gc = body.generationConfig as {
        responseSchema: Record<string, unknown>;
      };
      assert.deepEqual(gc.responseSchema, CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA);
      const props = gc.responseSchema.properties as Record<string, unknown>;
      assert.equal("phase2SignalRows" in props, false);
      assert.equal("phase2Signals" in props, false);

      const si = body.systemInstruction as {
        parts: Array<{ text: string }>;
      };
      assert.doesNotMatch(si.parts[0]!.text, /phase2SignalRows/);
      assert.doesNotMatch(si.parts[0]!.text, /gemini-phase2-flat-v1/);
      assert.equal(fetchMock.mock.calls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
