import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrganizerPostRetrievalQuery,
  buildSourcePreRetrievalQuery,
  mergeComparisonCandidates,
} from "@/lib/knowledge/comparison-candidate-retrieval";
import type { PublishedKnowledgeDocument } from "@/lib/knowledge/published-retrieval";

function doc(
  articleId: string,
  title: string,
  body = "body",
): PublishedKnowledgeDocument {
  return {
    articleId,
    articleVersionId: `${articleId}-version`,
    versionNumber: 1,
    citationId: `${articleId}:1`,
    title,
    summary: null,
    body,
    categoryId: "cat-1",
    categoryName: "Category",
    visibility: "team",
    ownerUserId: null,
  };
}

describe("comparison candidate retrieval", () => {
  it("builds bounded pre-retrieval query from title and excerpt only", () => {
    const query = buildSourcePreRetrievalQuery({
      sourceTitle: "汇丰香港",
      rawText: `${"长文本".repeat(5_000)} 关键词`,
    });
    assert.ok(query.includes("汇丰香港"));
    assert.ok(query.length <= 200);
    assert.doesNotMatch(query, /长文本{100,}/);
  });

  it("merges pre/post ranks deterministically with post rank tie-break", () => {
    const merged = mergeComparisonCandidates(
      [doc("article-b", "B"), doc("article-a", "A")],
      [doc("article-c", "C"), doc("article-a", "A better")],
      "A better",
    );
    assert.equal(merged[0]?.articleId, "article-a");
    assert.equal(merged[0]?.preRank, 2);
    assert.equal(merged[0]?.postRank, 2);
    assert.equal(merged[0]?.combinedScore, 12);
    assert.equal(merged[0]?.candidateKey, "C1");
    assert.equal(merged.length <= 3, true);
  });

  it("orders pre-only candidates by pre rank when post list is empty", () => {
    const merged = mergeComparisonCandidates(
      [doc("article-z", "Z"), doc("article-a", "A")],
      [],
      "query",
    );
    assert.equal(merged[0]?.articleId, "article-z");
    assert.equal(merged[0]?.preScore, 5);
    assert.equal(merged[1]?.articleId, "article-a");
    assert.equal(merged[1]?.preScore, 4);
  });

  it("builds post-organizer query from proposed fields", () => {
    const query = buildOrganizerPostRetrievalQuery({
      proposedTitle: "汇丰香港开户",
      proposedSummary: "资产要求说明",
      proposedCategory: "海外银行",
      proposedBody: "最低资产 50 万",
    });
    assert.match(query, /汇丰香港开户/);
    assert.match(query, /资产要求说明/);
    assert.match(query, /海外银行/);
    assert.match(query, /最低资产 50 万/);
  });
});
