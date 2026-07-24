/**
 * 5C-G2: Gemini Flat runtime parse split, contract mode, compose degradation.
 * No real Provider calls.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { parseCombinedCustomerInsightProviderOutput } from "@/lib/ai/customer-insights/phase2-parse";
import {
  composePhase2Insight,
} from "@/lib/ai/customer-insights/phase2-compose";
import {
  resolveAiProviderPhase2ContractMode,
} from "@/lib/ai/customer-insights/provider-contract-mode";
import { buildSystemPrompt } from "@/lib/ai/customer-insights/prompt-builder";
import { CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA } from "@/lib/ai/phase2/gemini-phase2-flat-schema";
import {
  GEMINI_PHASE2_FLAT_CONTRACT_VERSION,
  GEMINI_PHASE2_FLAT_COMPLEXITY_BUDGET,
} from "@/lib/ai/phase2/gemini-phase2-flat-contract";
import {
  measureGeminiFlatCandidateSchemaComplexity,
  measureProductionGeminiBaseSchemaComplexity,
} from "@/lib/ai/phase2/gemini-phase2-flat-complexity";
import { findGeminiUnsupportedSchemaPaths } from "@/lib/ai/phase2/provider-json-schema";
import { CUSTOMER_INSIGHT_JSON_SCHEMA } from "@/lib/ai/customer-insights/json-schema";
import { googleGeminiCustomerInsightProvider } from "@/lib/ai/providers/google-gemini";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";

const baseOutput = {
  intentLevel: "medium" as const,
  intentScore: 55,
  customerSummary: "客户处于跟进中",
  currentSituation: "已有初步沟通",
  keySignals: ["有明确项目兴趣"],
  riskFlags: [],
  missingInformation: ["预算未确认"],
  nextBestAction: "确认材料准备进度",
  suggestedFollowUpAt: null,
  suggestedEmployeeMessage:
    "您好，想确认一下您目前资料准备得怎么样，方便我帮您整理下一步说明。",
  confidence: 0.7,
  reasoning: "基于近期跟进记录",
};

function insightContext(
  overrides: Partial<CustomerInsightContext> = {},
): CustomerInsightContext {
  return {
    customerId: "c-g2",
    customerName: "测试客户",
    customerType: "individual",
    salesStage: "qualified",
    source: "referral",
    status: "active",
    requestedProjectName: "香港身份规划",
    sourceRemark: null,
    notes: "客户想了解香港高才通，费用和时间还在考虑",
    lastFollowUpAt: "2026-07-10T00:00:00.000Z",
    lastValidFollowUpAt: "2026-07-10T00:00:00.000Z",
    nextFollowUpAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    includeSensitiveFields: true,
    phone: null,
    wechatId: null,
    email: null,
    recentFollowUps: [
      {
        id: "fu-1",
        followUpTime: "2026-07-10T00:00:00.000Z",
        channel: "wechat",
        outcome: "replied",
        summary: "客户说费用有点高，想再比较",
        nextAction: "发送费用说明",
        customerIntent: "继续了解",
        isValidFollowUp: 1,
        nextFollowUpAt: "2026-07-30T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function flatConcernRow(overrides: Record<string, string> = {}) {
  return {
    kind: "concern",
    code: "COST_CONCERN",
    level: "medium",
    summary: "费用有点高",
    evidenceSourceType: "follow_up",
    evidenceSourceId: "fu-1",
    evidenceField: "",
    evidenceExcerpt: "费用有点高",
    ...overrides,
  };
}

describe("5C-G2 contract mode selection", () => {
  it("maps providers to isolated contract modes", () => {
    assert.equal(resolveAiProviderPhase2ContractMode("google_gemini"), "gemini_flat");
    assert.equal(resolveAiProviderPhase2ContractMode("openai_compatible"), "rich");
    assert.equal(resolveAiProviderPhase2ContractMode("mock"), "none");
  });

  it("Gemini prompt uses Flat instructions; OpenAI default uses rich", () => {
    const gemini = buildSystemPrompt("zh-Hans", { phase2ContractMode: "gemini_flat" });
    assert.match(gemini, /phase2SignalRows/);
    assert.match(gemini, new RegExp(GEMINI_PHASE2_FLAT_CONTRACT_VERSION));
    assert.doesNotMatch(gemini, /optional top-level key phase2Signals/);

    const openai = buildSystemPrompt("zh-Hans");
    assert.match(openai, /phase2Signals/);
    assert.doesNotMatch(openai, /phase2SignalRows/);

    const none = buildSystemPrompt("zh-Hans", { phase2ContractMode: "none" });
    assert.doesNotMatch(none, /phase2SignalRows/);
    assert.doesNotMatch(none, /optional top-level key phase2Signals/);
  });
});

describe("5C-G2 Base / Flat Phase2 split parse", () => {
  it("Base valid + empty Flat rows → Base ready, Phase2 missing", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      { ...baseOutput, phase2SignalRows: [] },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2ContractMode, "gemini_flat");
    assert.equal(parsed.phase2SignalsStatus, "missing");
    assert.equal(parsed.phase2Signals, null);
    assert.equal(parsed.output.intentScore, 55);
  });

  it("Base valid + missing Flat rows → Base ready, Phase2 missing", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(baseOutput, {
      phase2ContractMode: "gemini_flat",
    });
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2SignalsStatus, "missing");
  });

  it("Base valid + invalid Flat rows → Base ready, Phase2 invalid_schema", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      { ...baseOutput, phase2SignalRows: [{ kind: 1 }] },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2SignalsStatus, "invalid_schema");
    assert.equal(parsed.phase2Signals, null);
  });

  it("Base valid + valid Flat concern → signals valid for compose", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2SignalRows: [flatConcernRow()],
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2SignalsStatus, "valid");
    assert.ok(parsed.phase2Signals);
    assert.equal(parsed.phase2Signals.concerns.length, 1);
    assert.equal(parsed.phase2Signals.concerns[0]!.evidence.length, 1);
  });

  it("Base invalid fails even when Flat rows are valid", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        intentLevel: "medium",
        phase2SignalRows: [flatConcernRow()],
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, false);
    if (parsed.success) return;
    assert.equal(parsed.reason, "base_invalid");
  });

  it("unknown top-level still fails whole parse", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      { ...baseOutput, secretMeta: true, phase2SignalRows: [] },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, false);
  });

  it("gemini_flat mode ignores rich phase2Signals (does not fail Base)", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2Signals: { needClarity: "bad" },
        phase2SignalRows: [],
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2SignalsStatus, "missing");
  });

  it("rich mode ignores Flat rows and keeps OpenAI path", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2SignalRows: [flatConcernRow()],
        phase2Signals: null,
      },
      { phase2ContractMode: "rich" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2SignalsStatus, "missing");
    assert.equal(parsed.phase2ContractMode, "rich");
  });

  it("unknown behaviour code Flat rows degrade to missing without failing Base", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2SignalRows: [
          flatConcernRow({
            kind: "customer_behavior_risk",
            code: "staff_overdue",
            summary: "staff late",
            evidenceExcerpt: "费用有点高",
          }),
        ],
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2SignalsStatus, "missing");
  });

  it("Flat null / object / oversized degrade Phase2 without failing Base", () => {
    for (const rows of [null, { bad: true }, Array.from({ length: 21 }, () => flatConcernRow())]) {
      const parsed = parseCombinedCustomerInsightProviderOutput(
        { ...baseOutput, phase2SignalRows: rows },
        { phase2ContractMode: "gemini_flat" },
      );
      assert.equal(parsed.success, true);
      if (!parsed.success) continue;
      assert.equal(parsed.phase2SignalsStatus, "invalid_schema");
      assert.equal(parsed.output.intentScore, 55);
    }
  });

  it("non-object provider response fails whole parse", () => {
    assert.equal(
      parseCombinedCustomerInsightProviderOutput("not-json", {
        phase2ContractMode: "gemini_flat",
      }).success,
      false,
    );
  });
});

describe("5C-G2 Flat → Evidence → Compose", () => {
  it("valid Flat evidence composes Phase2; cross-customer follow-up fails evidence", () => {
    const ctx = insightContext();
    const okParsed = parseCombinedCustomerInsightProviderOutput(
      { ...baseOutput, phase2SignalRows: [flatConcernRow()] },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(okParsed.success, true);
    if (!okParsed.success) return;

    const ok = composePhase2Insight({
      insightContext: ctx,
      signals: okParsed.phase2Signals,
      signalsStatus: okParsed.phase2SignalsStatus,
      baseMissingInformation: baseOutput.missingInformation,
      suggestedEmployeeMessage: baseOutput.suggestedEmployeeMessage,
    });
    assert.equal(ok.ok, true);

    const badParsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2SignalRows: [
          flatConcernRow({
            evidenceSourceId: "fu-other-customer",
            evidenceExcerpt: "费用有点高",
          }),
        ],
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(badParsed.success, true);
    if (!badParsed.success) return;
    const bad = composePhase2Insight({
      insightContext: ctx,
      signals: badParsed.phase2Signals,
      signalsStatus: badParsed.phase2SignalsStatus,
      baseMissingInformation: baseOutput.missingInformation,
      suggestedEmployeeMessage: baseOutput.suggestedEmployeeMessage,
    });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.equal(bad.code, "invalid_evidence");
  });

  it("valid initial_note and customer_field evidence candidates compose", () => {
    const ctx = insightContext();
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2SignalRows: [
          flatConcernRow({
            evidenceSourceType: "initial_note",
            evidenceSourceId: "initial_note",
            evidenceField: "",
            evidenceExcerpt: "费用和时间还在考虑",
            summary: "cost timeline concern from note",
          }),
          {
            kind: "opportunity_signal",
            code: "need_clarity",
            level: "high",
            summary: "project interest",
            evidenceSourceType: "customer_field",
            evidenceSourceId: "requested_project_name",
            evidenceField: "requested_project_name",
            evidenceExcerpt: "香港身份规划",
          },
        ],
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2SignalsStatus, "valid");
    const composed = composePhase2Insight({
      insightContext: ctx,
      signals: parsed.phase2Signals,
      signalsStatus: parsed.phase2SignalsStatus,
      baseMissingInformation: baseOutput.missingInformation,
      suggestedEmployeeMessage: baseOutput.suggestedEmployeeMessage,
    });
    assert.equal(composed.ok, true);
  });

  it("mixed valid/invalid evidence keeps valid rows and composes", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2SignalRows: [
          flatConcernRow(),
          flatConcernRow({
            code: "TIMELINE_CONCERN",
            evidenceSourceId: "fu-missing",
            evidenceExcerpt: "费用有点高",
            summary: "bad source",
          }),
        ],
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2Signals?.concerns.length, 2);
    const composed = composePhase2Insight({
      insightContext: insightContext(),
      signals: parsed.phase2Signals,
      signalsStatus: parsed.phase2SignalsStatus,
      baseMissingInformation: baseOutput.missingInformation,
      suggestedEmployeeMessage: baseOutput.suggestedEmployeeMessage,
    });
    assert.equal(composed.ok, true);
    if (!composed.ok) return;
    assert.ok(composed.phase2.painPoints.length >= 1);
  });

  it("partially similar non-verbatim excerpt fails evidence", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2SignalRows: [
          flatConcernRow({
            // Shares tokens but is not a containment excerpt of the follow-up text.
            evidenceExcerpt: "费用有点高而且还想比较别家银行利率",
          }),
        ],
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    const composed = composePhase2Insight({
      insightContext: insightContext(),
      signals: parsed.phase2Signals,
      signalsStatus: parsed.phase2SignalsStatus,
      baseMissingInformation: baseOutput.missingInformation,
      suggestedEmployeeMessage: baseOutput.suggestedEmployeeMessage,
    });
    assert.equal(composed.ok, false);
    if (composed.ok) return;
    assert.equal(composed.code, "invalid_evidence");
  });

  it("non-verbatim excerpt fails evidence after Flat adapt", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2SignalRows: [
          flatConcernRow({
            evidenceExcerpt: "这是不存在的改写摘要",
          }),
        ],
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    const composed = composePhase2Insight({
      insightContext: insightContext(),
      signals: parsed.phase2Signals,
      signalsStatus: parsed.phase2SignalsStatus,
      baseMissingInformation: baseOutput.missingInformation,
      suggestedEmployeeMessage: baseOutput.suggestedEmployeeMessage,
    });
    assert.equal(composed.ok, false);
    if (composed.ok) return;
    assert.equal(composed.code, "invalid_evidence");
  });

  it("system_rule Flat row never reaches compose as valid signals", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2SignalRows: [
          flatConcernRow({
            evidenceSourceType: "system_rule",
            evidenceSourceId: "RULE_X",
            evidenceExcerpt: "费用有点高",
          }),
        ],
      },
      { phase2ContractMode: "gemini_flat" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2SignalsStatus, "missing");
  });
});

describe("5C-G2 Gemini final runtime request", () => {
  it("uses Flat schema + Flat prompt in one Provider Call", async () => {
    let captured: Record<string, unknown> | undefined;
    const fetchMock = mock.fn(async (_url: unknown, init: unknown) => {
      captured = JSON.parse(String((init as RequestInit).body)) as Record<
        string,
        unknown
      >;
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    ...baseOutput,
                    phase2SignalRows: [],
                  }),
                },
              ],
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
        insightContext() as CustomerInsightContext,
        {
          aiAnalysisLanguage: "zh-Hans",
          aiPromptTemplate: "分析：{{context_json}}",
          aiPromptVersion: "test",
        } as EffectiveAiSettings,
        {
          apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          apiKey: "test-key-not-real",
          temperature: 0.2,
          maxTokens: 2048,
          timeoutMs: 5000,
        },
      );
      assert.ok(captured);
      const gc = captured.generationConfig as {
        responseSchema: unknown;
      };
      assert.deepEqual(
        gc.responseSchema,
        CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA,
      );
      assert.deepEqual(findGeminiUnsupportedSchemaPaths(gc.responseSchema), []);
      const base = measureProductionGeminiBaseSchemaComplexity();
      const flat = measureGeminiFlatCandidateSchemaComplexity();
      assert.ok(
        flat.serializedLength - base.serializedLength <=
          GEMINI_PHASE2_FLAT_COMPLEXITY_BUDGET.maxSerializedIncrease,
      );
      const si = captured.systemInstruction as { parts: Array<{ text: string }> };
      assert.match(si.parts[0]!.text, /phase2SignalRows/);
      assert.equal(fetchMock.mock.calls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("5C-G2 OpenAI rich regression", () => {
  it("OpenAI schema still has rich phase2Signals anyOf and never phase2SignalRows", () => {
    const props = CUSTOMER_INSIGHT_JSON_SCHEMA.properties as Record<string, unknown>;
    assert.ok("phase2Signals" in props);
    assert.equal("phase2SignalRows" in props, false);
    const phase2 = props.phase2Signals as { anyOf?: unknown[] };
    assert.ok(Array.isArray(phase2.anyOf));
    // Stable property-key snapshot for OpenAI combined schema (regression lock).
    assert.deepEqual(Object.keys(props).sort(), [
      "confidence",
      "currentSituation",
      "customerSummary",
      "intentLevel",
      "intentScore",
      "keySignals",
      "missingInformation",
      "nextBestAction",
      "phase2Signals",
      "reasoning",
      "riskFlags",
      "suggestedEmployeeMessage",
      "suggestedFollowUpAt",
    ]);
  });

  it("rich valid phase2Signals still parses under rich mode", () => {
    const parsed = parseCombinedCustomerInsightProviderOutput(
      {
        ...baseOutput,
        phase2Signals: {
          needClarity: null,
          customerInitiative: null,
          timelineReadiness: null,
          documentReadiness: null,
          concerns: [],
          customerBehaviorRisk: [],
          recommendedTopic: null,
        },
      },
      { phase2ContractMode: "rich" },
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.phase2SignalsStatus, "valid");
  });
});
