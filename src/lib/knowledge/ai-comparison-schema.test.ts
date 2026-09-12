import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyNoMatchComparisonResult,
  parseKnowledgeAiComparisonOutput,
} from "@/lib/knowledge/ai-comparison-schema";

describe("ai comparison schema", () => {
  it("accepts structured diff output", () => {
    const parsed = parseKnowledgeAiComparisonOutput({
      relationship: "update_existing",
      matchedCandidateKey: "C1",
      matchConfidence: 0.92,
      newFacts: [
        {
          id: "nf-1",
          topic: "资产要求",
          existingValue: null,
          incomingValue: "新增说明",
          explanation: "来源新增信息",
          confidence: 0.8,
          sourceExcerpt: "新增说明",
          existingExcerpt: null,
        },
      ],
      changedFacts: [
        {
          id: "cf-1",
          topic: "最低资产",
          existingValue: "50 万",
          incomingValue: "100 万",
          explanation: "金额发生变化",
          confidence: 0.9,
          sourceExcerpt: "100 万",
          existingExcerpt: "50 万",
        },
      ],
      conflicts: [],
      uncertainties: [
        {
          id: "u-1",
          topic: "最低资产",
          existingValue: "50 万",
          incomingValue: "可能 50 万，也可能 100 万，以经理确认为准",
          explanation: "来源本身不确定",
          confidence: 0.7,
          sourceExcerpt: "可能 50 万",
          existingExcerpt: null,
        },
      ],
      suggestedUpdates: [
        {
          topic: "资产要求",
          suggestion: "确认生效时间后更新资产要求",
          rationale: "金额变化需要人工确认",
          confidence: 0.86,
        },
      ],
    });
    assert.equal(parsed.success, true);
  });

  it("rejects unknown candidate keys and oversized arrays", () => {
    const invalidKey = parseKnowledgeAiComparisonOutput({
      relationship: "update_existing",
      matchedCandidateKey: "C99",
      matchConfidence: 0.5,
      newFacts: [],
      changedFacts: [],
      conflicts: [],
      uncertainties: [],
      suggestedUpdates: [],
    });
    assert.equal(invalidKey.success, false);

    const tooMany = parseKnowledgeAiComparisonOutput({
      relationship: "new_article",
      matchedCandidateKey: null,
      matchConfidence: 0.2,
      newFacts: Array.from({ length: 21 }, (_, index) => ({
        id: `nf-${index}`,
        topic: "topic",
        existingValue: null,
        incomingValue: "x",
        explanation: "x",
        confidence: 0.5,
        sourceExcerpt: null,
        existingExcerpt: null,
      })),
      changedFacts: [],
      conflicts: [],
      uncertainties: [],
      suggestedUpdates: [],
    });
    assert.equal(tooMany.success, false);
  });

  it("provides empty no-match result shape", () => {
    const result = emptyNoMatchComparisonResult();
    assert.equal(result.relationship, "no_match");
    assert.equal(result.matchedCandidateKey, null);
    assert.deepEqual(result.newFacts, []);
  });
});
