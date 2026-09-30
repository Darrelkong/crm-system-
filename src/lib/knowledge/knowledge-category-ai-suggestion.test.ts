import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mockKnowledgeCategoryAiSuggestion } from "@/lib/knowledge/knowledge-category-ai-suggestion-mock";
import {
  finalizeKnowledgeCategoryAiSuggestion,
} from "@/lib/knowledge/knowledge-category-ai-suggestion-service";

const candidates = [
  { id: "11111111-1111-4111-8111-111111111101", name: "A", description: null },
  { id: "22222222-2222-4222-8222-222222222202", name: "B", description: null },
];

describe("knowledge category AI suggestion", () => {
  it("D: rejects category ID not in candidate list", () => {
    const result = finalizeKnowledgeCategoryAiSuggestion({
      raw: {
        categoryId: "33333333-3333-4333-8333-333333333303",
        confidenceBand: "high",
      },
      candidates,
    });
    assert.equal(result.status, "invalid_output");
    assert.equal(result.resolutionSource, null);
  });

  it("F: low confidence stays unresolved", () => {
    const result = finalizeKnowledgeCategoryAiSuggestion({
      raw: { categoryId: null, confidenceBand: "low" },
      candidates,
    });
    assert.equal(result.status, "insufficient_confidence");
    assert.equal(result.resolutionSource, null);
  });

  it("C: high confidence suggests existing category", () => {
    const result = finalizeKnowledgeCategoryAiSuggestion({
      raw: {
        categoryId: candidates[0]!.id,
        confidenceBand: "high",
      },
      candidates,
    });
    assert.equal(result.status, "suggested");
    assert.equal(result.categoryId, candidates[0]!.id);
    assert.equal(result.resolutionSource, "ai_suggestion");
    assert.equal(result.requiresConfirmation, false);
  });

  it("G: medium confidence requires confirmation", () => {
    const result = finalizeKnowledgeCategoryAiSuggestion({
      raw: {
        categoryId: candidates[1]!.id,
        confidenceBand: "medium",
      },
      candidates,
    });
    assert.equal(result.status, "suggested");
    assert.equal(result.requiresConfirmation, true);
  });

  it("mock markers choose supplied category IDs only", () => {
    const high = mockKnowledgeCategoryAiSuggestion({
      context: {
        requestedProjectCode: "hk_bank_account",
        requestedProjectLabel: "香港银行账户",
        title: "t",
        summary: "s",
        body: "@@knowledge-category-mock:high:1",
      },
      candidates,
    });
    assert.equal(high.categoryId, candidates[1]!.id);
    assert.equal(high.confidenceBand, "high");

    const low = mockKnowledgeCategoryAiSuggestion({
      context: {
        requestedProjectCode: "hk_bank_account",
        requestedProjectLabel: "香港银行账户",
        title: "t",
        summary: "s",
        body: "@@knowledge-category-mock:low",
      },
      candidates,
    });
    assert.equal(low.categoryId, null);
  });
});
