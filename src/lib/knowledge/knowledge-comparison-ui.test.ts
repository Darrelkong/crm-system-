import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildArticleHistoryHref,
  resolveMatchedArticleTitle,
} from "@/lib/knowledge/knowledge-comparison-orchestration";
import type { KnowledgeComparisonDetail } from "@/lib/knowledge/comparison-types";

const root = process.cwd();

describe("Knowledge comparison UI boundary", () => {
  it("uses shared panel with i18n keys and mobile-safe stacked layout", () => {
    const panel = readFileSync(
      join(root, "src/components/knowledge/knowledge-comparison-panel.tsx"),
      "utf8",
    );
    const section = readFileSync(
      join(root, "src/components/knowledge/knowledge-comparison-source-section.tsx"),
      "utf8",
    );
    const ingest = readFileSync(
      join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    const review = readFileSync(
      join(root, "src/components/knowledge/knowledge-review-center-client.tsx"),
      "utf8",
    );

    assert.match(panel, /knowledge\.comparison\./);
    assert.match(panel, /grid grid-cols-2/);
    assert.match(panel, /whitespace-pre-wrap break-words/);
    assert.match(panel, /knowledge\.article\.publishedVersionBadge/);
    assert.doesNotMatch(panel, /AI_TIMEOUT|AI_COMPARISON_/);
    assert.doesNotMatch(panel, /sm:grid-cols-2/);
    assert.match(section, /useKnowledgeSourceComparison/);
    assert.match(ingest, /KnowledgeComparisonSourceSection/);
    assert.match(ingest, /setAutoCompareSignal/);
    assert.match(review, /linkedSourceId/);
    assert.match(review, /KnowledgeComparisonSourceSection/);
  });

  it("resolves matched article title from server candidate snapshot only", () => {
    const detail: KnowledgeComparisonDetail = {
      id: "run-1",
      sourceId: "source-1",
      organizationRunId: "org-1",
      status: "completed",
      relationship: "update_existing",
      matchedArticleId: "article-1",
      matchedArticleVersionId: "version-1",
      matchedVersionNumber: 1,
      matchConfidence: 0.9,
      candidateSnapshot: [
        {
          candidateKey: "C1",
          articleId: "article-1",
          articleVersionId: "version-1",
          versionNumber: 1,
          title: "汇丰香港测试知识",
          categoryName: "测试",
          preRank: 1,
          preScore: 5,
          postRank: 1,
          postScore: 10,
          combinedScore: 15,
          bodyExcerptStart: 0,
          bodyExcerptEnd: 10,
        },
      ],
      comparison: null,
      degradationLevel: null,
      provider: "mock",
      model: "mock",
      failureCode: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    };
    assert.equal(resolveMatchedArticleTitle(detail), "汇丰香港测试知识");
    assert.equal(
      buildArticleHistoryHref(detail.matchedArticleId!, detail.matchedVersionNumber),
      "/knowledge/articles/article-1/history?version=1",
    );
  });
});
