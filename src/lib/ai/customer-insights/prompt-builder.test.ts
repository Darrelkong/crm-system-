import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import {
  buildSystemPrompt,
  serializeCustomerInsightContext,
} from "@/lib/ai/customer-insights/prompt-builder";

function buildSampleContext(
  overrides: Partial<CustomerInsightContext> = {},
): CustomerInsightContext {
  return {
    customerId: "customer-uuid",
    customerName: "測試客戶",
    customerType: "individual",
    salesStage: "lead",
    source: "web",
    status: "active",
    requestedProjectName: "專案 A",
    sourceRemark: "來源備註",
    notes: "內部備註內容",
    lastFollowUpAt: "2026-06-29T10:00:00.000Z",
    lastValidFollowUpAt: "2026-06-29T10:00:00.000Z",
    nextFollowUpAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    includeSensitiveFields: true,
    phone: "91234567",
    wechatId: "wx_test_user",
    email: "customer@example.com",
    recentFollowUps: [
      {
        id: "follow-up-1",
        followUpTime: "2026-06-29T10:00:00.000Z",
        channel: "wechat",
        outcome: "interested",
        summary: "客戶表示下週再聯絡",
        customerIntent: "high",
        isValidFollowUp: 1,
        nextFollowUpAt: "2026-07-01T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("serializeCustomerInsightContext", () => {
  it("serializes sanitized context without structured contact fields", () => {
    const context = buildSampleContext();
    const serialized = serializeCustomerInsightContext(context);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    assert.equal(parsed.phone, null);
    assert.equal(parsed.wechatId, null);
    assert.equal(parsed.email, null);
    assert.equal(parsed.notes, "內部備註內容");
    assert.equal(parsed.sourceRemark, "來源備註");
    assert.equal(parsed.includeSensitiveFields, undefined);
  });

  it("does not mutate the original context", () => {
    const context = buildSampleContext();

    serializeCustomerInsightContext(context);

    assert.equal(context.phone, "91234567");
    assert.equal(context.wechatId, "wx_test_user");
    assert.equal(context.email, "customer@example.com");
    assert.equal(context.includeSensitiveFields, true);
  });

  it("preserves follow-up summary and customerIntent in serialized output", () => {
    const context = buildSampleContext();
    const serialized = serializeCustomerInsightContext(context);
    const parsed = JSON.parse(serialized) as {
      recentFollowUps: Array<{ summary: string; customerIntent: string | null }>;
    };

    assert.equal(parsed.recentFollowUps.length, 1);
    assert.equal(parsed.recentFollowUps[0]?.summary, "客戶表示下週再聯絡");
    assert.equal(parsed.recentFollowUps[0]?.customerIntent, "high");
  });
});

describe("buildSystemPrompt", () => {
  it("requires one raw JSON object without markdown or explanations", () => {
    const prompt = buildSystemPrompt("zh-Hans");
    assert.match(prompt, /Return only one valid JSON object/);
    assert.match(prompt, /Do not include markdown fences/);
    assert.match(prompt, /Do not include explanations before or after the JSON/);
  });
});
