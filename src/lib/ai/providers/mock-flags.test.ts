import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowMockDeepInsightGeneration,
  isMockCustomerInsightModel,
  MOCK_CUSTOMER_INSIGHT_MODEL,
  MOCK_CUSTOMER_INSIGHT_MODEL_IDS,
} from "@/lib/ai/providers/mock-constants";

describe("mock customer insight identification", () => {
  it("recognizes all known repository mock model ids", () => {
    assert.ok(MOCK_CUSTOMER_INSIGHT_MODEL_IDS.includes(MOCK_CUSTOMER_INSIGHT_MODEL));
    assert.ok(MOCK_CUSTOMER_INSIGHT_MODEL_IDS.includes("mock"));
    assert.equal(isMockCustomerInsightModel(MOCK_CUSTOMER_INSIGHT_MODEL), true);
    assert.equal(isMockCustomerInsightModel("mock"), true);
    assert.equal(isMockCustomerInsightModel("mock-customer-insight-v2"), true);
    assert.equal(isMockCustomerInsightModel("gemini-2.0-flash"), false);
  });
});

describe("allowMockDeepInsightGeneration flags", () => {
  it("defaults to denied when env flags are unset", () => {
    const prevBind = process.env.CRM_ALLOW_TEST_DB_BIND;
    const prevMock = process.env.CRM_ALLOW_MOCK_AI;
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    delete process.env.CRM_ALLOW_MOCK_AI;
    try {
      assert.equal(allowMockDeepInsightGeneration(), false);
      process.env.CRM_ALLOW_TEST_DB_BIND = "0";
      process.env.CRM_ALLOW_MOCK_AI = "true";
      assert.equal(allowMockDeepInsightGeneration(), false);
      process.env.CRM_ALLOW_MOCK_AI = "1";
      assert.equal(allowMockDeepInsightGeneration(), true);
    } finally {
      if (prevBind === undefined) delete process.env.CRM_ALLOW_TEST_DB_BIND;
      else process.env.CRM_ALLOW_TEST_DB_BIND = prevBind;
      if (prevMock === undefined) delete process.env.CRM_ALLOW_MOCK_AI;
      else process.env.CRM_ALLOW_MOCK_AI = prevMock;
    }
  });

  it("is sourced only from process.env (not request-shaped objects)", () => {
    const source = allowMockDeepInsightGeneration.toString();
    assert.equal(source.includes("process.env"), true);
    assert.equal(source.includes("headers"), false);
    assert.equal(source.includes("searchParams"), false);
    assert.equal(source.includes("request"), false);
  });
});
