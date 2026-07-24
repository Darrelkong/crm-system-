import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import type { CustomerInsightOutput } from "@/lib/ai/customer-insights/schema";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import { mockCustomerInsightProvider } from "@/lib/ai/providers/mock";

const settings = {
  aiAnalysisLanguage: "zh-Hant",
} as EffectiveAiSettings;

function buildContext(
  overrides: Partial<CustomerInsightContext> = {},
): CustomerInsightContext {
  return {
    customerId: "customer-uuid",
    customerName: "測試客戶",
    customerType: "individual",
    salesStage: "lead",
    source: "web",
    status: "active",
    requestedProjectName: null,
    sourceRemark: null,
    notes: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    updatedAt: "2026-06-30T00:00:00.000Z",
    includeSensitiveFields: true,
    phone: null,
    wechatId: null,
    email: null,
    recentFollowUps: [],
    ...overrides,
  };
}

describe("mockCustomerInsightProvider", () => {
  it("does not flag missing contact fields when phone and wechat are absent", async () => {
    const result = (await mockCustomerInsightProvider.analyzeCustomerInsight(
      buildContext(),
      settings,
    )) as CustomerInsightOutput;

    assert.equal(
      result.missingInformation.some((item) => item.includes("聯絡方式")),
      false,
    );
    assert.equal(
      result.missingInformation.some((item) => item.includes("跟進互動")),
      true,
    );
  });

  it("uses follow-up signals when recent follow-ups exist", async () => {
    const result = (await mockCustomerInsightProvider.analyzeCustomerInsight(
      buildContext({
        requestedProjectName: "專案 A",
        lastFollowUpAt: "2026-06-29T10:00:00.000Z",
        lastValidFollowUpAt: "2026-06-29T10:00:00.000Z",
        recentFollowUps: [
          {
            id: "follow-up-1",
            followUpTime: "2026-06-29T10:00:00.000Z",
            channel: "wechat",
            outcome: "interested",
            summary: "客戶有興趣",
            nextAction: null,
            customerIntent: "high",
            isValidFollowUp: 1,
            nextFollowUpAt: null,
          },
        ],
      }),
      settings,
    )) as CustomerInsightOutput;

    assert.equal(
      result.keySignals.some((item) => item.includes("有效跟進")),
      true,
    );
    assert.equal(
      result.missingInformation.some((item) => item.includes("跟進互動")),
      false,
    );
  });
});
