import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { serializeCustomerInsightContext } from "@/lib/ai/customer-insights/prompt-builder";

describe("serializeCustomerInsightContext current behavior", () => {
  it("current behavior: serialized context includes phone wechatId email and notes", () => {
    const context = {
      customerId: "customer-uuid",
      customerName: "測試客戶",
      customerType: "individual",
      salesStage: "lead",
      source: "web",
      status: "active",
      requestedProjectName: "專案 A",
      sourceRemark: "來源備註",
      notes: "內部備註內容",
      lastFollowUpAt: null,
      lastValidFollowUpAt: null,
      nextFollowUpAt: null,
      updatedAt: "2026-06-30T00:00:00.000Z",
      includeSensitiveFields: true,
      phone: "91234567",
      wechatId: "wx_test_user",
      email: "customer@example.com",
      recentFollowUps: [],
    } satisfies CustomerInsightContext;

    const serialized = serializeCustomerInsightContext(context);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    assert.equal(parsed.phone, "91234567");
    assert.equal(parsed.wechatId, "wx_test_user");
    assert.equal(parsed.email, "customer@example.com");
    assert.equal(parsed.notes, "內部備註內容");
    assert.equal(parsed.includeSensitiveFields, undefined);
  });
});
