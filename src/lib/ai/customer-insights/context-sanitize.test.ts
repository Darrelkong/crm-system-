import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { sanitizeCustomerInsightContextForProvider } from "@/lib/ai/customer-insights/context-sanitize";

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
    notes: "內部備註，聯絡 91234567",
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

describe("sanitizeCustomerInsightContextForProvider", () => {
  it("removes structured contact fields from the returned context", () => {
    const context = buildSampleContext();
    const sanitized = sanitizeCustomerInsightContextForProvider(context);

    assert.equal(sanitized.phone, null);
    assert.equal(sanitized.wechatId, null);
    assert.equal(sanitized.email, null);
    assert.equal(sanitized.includeSensitiveFields, false);
  });

  it("does not mutate the original context", () => {
    const context = buildSampleContext();
    const originalFollowUp = context.recentFollowUps[0];

    sanitizeCustomerInsightContextForProvider(context);

    assert.equal(context.phone, "91234567");
    assert.equal(context.wechatId, "wx_test_user");
    assert.equal(context.email, "customer@example.com");
    assert.equal(context.includeSensitiveFields, true);
    assert.equal(context.recentFollowUps[0], originalFollowUp);
  });

  it("preserves business analysis fields", () => {
    const context = buildSampleContext();
    const sanitized = sanitizeCustomerInsightContextForProvider(context);

    assert.equal(sanitized.customerId, context.customerId);
    assert.equal(sanitized.customerName, context.customerName);
    assert.equal(sanitized.customerType, context.customerType);
    assert.equal(sanitized.salesStage, context.salesStage);
    assert.equal(sanitized.source, context.source);
    assert.equal(sanitized.status, context.status);
    assert.equal(sanitized.requestedProjectName, context.requestedProjectName);
    assert.equal(sanitized.sourceRemark, context.sourceRemark);
    assert.equal(sanitized.notes, context.notes);
    assert.equal(sanitized.lastFollowUpAt, context.lastFollowUpAt);
    assert.equal(sanitized.lastValidFollowUpAt, context.lastValidFollowUpAt);
    assert.equal(sanitized.nextFollowUpAt, context.nextFollowUpAt);
    assert.equal(sanitized.updatedAt, context.updatedAt);
  });

  it("preserves follow-up records without mutation", () => {
    const context = buildSampleContext();
    const sanitized = sanitizeCustomerInsightContextForProvider(context);

    assert.equal(sanitized.recentFollowUps.length, 1);
    assert.deepEqual(sanitized.recentFollowUps[0], context.recentFollowUps[0]);
    assert.notEqual(sanitized.recentFollowUps, context.recentFollowUps);
    assert.notEqual(sanitized.recentFollowUps[0], context.recentFollowUps[0]);
  });

  it("does not redact embedded contact info in notes or follow-up summary", () => {
    const context = buildSampleContext({
      notes: "請致電 91234567 或 email test@example.com",
      recentFollowUps: [
        {
          id: "follow-up-1",
          followUpTime: "2026-06-29T10:00:00.000Z",
          channel: "phone",
          outcome: "callback",
          summary: "微信 wx_embedded 已約下次",
          customerIntent: "medium",
          isValidFollowUp: 1,
          nextFollowUpAt: null,
        },
      ],
    });

    const sanitized = sanitizeCustomerInsightContextForProvider(context);

    assert.equal(sanitized.notes, context.notes);
    assert.equal(sanitized.recentFollowUps[0]?.summary, context.recentFollowUps[0]?.summary);
  });

  it("handles null contact fields on input", () => {
    const context = buildSampleContext({
      phone: null,
      wechatId: null,
      email: null,
      includeSensitiveFields: false,
    });

    const sanitized = sanitizeCustomerInsightContextForProvider(context);

    assert.equal(sanitized.phone, null);
    assert.equal(sanitized.wechatId, null);
    assert.equal(sanitized.email, null);
    assert.equal(sanitized.includeSensitiveFields, false);
  });
});
