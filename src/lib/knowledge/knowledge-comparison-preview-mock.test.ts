import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildKnowledgeComparisonPreviewMock,
  shouldUseKnowledgeComparisonPreviewMock,
} from "@/lib/knowledge/knowledge-comparison-preview-mock";
import type { ComparisonCandidate } from "@/lib/knowledge/comparison-candidate-retrieval";

const candidates: ComparisonCandidate[] = [
  {
    candidateKey: "C1",
    articleId: "article-a",
    articleVersionId: "version-a",
    versionNumber: 1,
    title: "汇丰香港测试知识",
    summary: null,
    categoryName: "测试",
    visibility: "team",
    bodyExcerpt: "最低资产 50 万",
    bodyExcerptStart: 0,
    bodyExcerptEnd: 10,
    preRank: 1,
    preScore: 5,
    postRank: 1,
    postScore: 10,
    combinedScore: 15,
  },
];

describe("knowledge comparison preview mock", () => {
  it("activates only in local preview with marker content", () => {
    const body =
      "汇丰最新资料显示最低资产要求为 100 万，具体生效日期需经理确认。";
    assert.equal(
      shouldUseKnowledgeComparisonPreviewMock(body, candidates, {
        NODE_ENV: "development",
        CRM_LOCAL_PREVIEW_AUTH_SIMULATION_ENABLED: "true",
      }),
      true,
    );
    assert.equal(
      shouldUseKnowledgeComparisonPreviewMock(body, candidates, {
        NODE_ENV: "production",
        CRM_LOCAL_PREVIEW_AUTH_SIMULATION_ENABLED: "true",
      }),
      false,
    );
  });

  it("returns update_existing with 50万 vs 100万 preview diff", () => {
    const output = buildKnowledgeComparisonPreviewMock(candidates);
    assert.equal(output.relationship, "update_existing");
    assert.equal(output.matchConfidence, 0.92);
    assert.equal(output.changedFacts[0]?.existingValue, "最低资产 50 万");
    assert.equal(output.changedFacts[0]?.incomingValue, "最低资产 100 万");
    assert.equal(output.uncertainties.length, 1);
    assert.equal(output.suggestedUpdates.length, 1);
  });
});
