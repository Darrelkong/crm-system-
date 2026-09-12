import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildArticleHistoryHref,
  countComparisonDiffGroups,
  createKnowledgeComparisonRequestGuard,
  formatMatchConfidencePercent,
  resolveComparisonConfidenceTone,
  shouldAutoCompareAfterOrganize,
  shouldExpandComparisonGroupByDefault,
} from "@/lib/knowledge/knowledge-comparison-orchestration";
import type { KnowledgeComparisonDetail } from "@/lib/knowledge/comparison-types";

function sampleComparison(
  overrides: Partial<KnowledgeComparisonDetail> = {},
): KnowledgeComparisonDetail {
  return {
    id: "run-1",
    sourceId: "source-1",
    organizationRunId: "org-1",
    status: "completed",
    relationship: "update_existing",
    matchedArticleId: "article-1",
    matchedArticleVersionId: "version-1",
    matchedVersionNumber: 1,
    matchConfidence: 0.92,
    candidateSnapshot: [],
    comparison: {
      relationship: "update_existing",
      matchedCandidateKey: "C1",
      matchConfidence: 0.92,
      newFacts: [{ id: "n1" } as never],
      changedFacts: [{ id: "c1" } as never, { id: "c2" } as never],
      conflicts: [],
      uncertainties: [],
      suggestedUpdates: [{ topic: "资产要求" } as never],
    },
    degradationLevel: null,
    provider: "mock",
    model: "mock",
    failureCode: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

describe("knowledge comparison orchestration", () => {
  it("auto compare only once per organized source", () => {
    assert.equal(
      shouldAutoCompareAfterOrganize({
        canExecute: true,
        organizationReady: true,
        sourceStatus: "organized",
        sourceId: "source-1",
        autoCompareAttemptedForSourceId: null,
      }),
      true,
    );
    assert.equal(
      shouldAutoCompareAfterOrganize({
        canExecute: true,
        organizationReady: true,
        sourceStatus: "organized",
        sourceId: "source-1",
        autoCompareAttemptedForSourceId: "source-1",
      }),
      false,
    );
    assert.equal(
      shouldAutoCompareAfterOrganize({
        canExecute: false,
        organizationReady: true,
        sourceStatus: "organized",
        sourceId: "source-1",
        autoCompareAttemptedForSourceId: null,
      }),
      false,
    );
    assert.equal(
      shouldAutoCompareAfterOrganize({
        canExecute: true,
        organizationReady: false,
        sourceStatus: "organized",
        sourceId: "source-1",
        autoCompareAttemptedForSourceId: null,
      }),
      false,
    );
  });

  it("ignores stale comparison responses via request guard", () => {
    const guard = createKnowledgeComparisonRequestGuard();
    const first = guard.begin();
    const second = guard.begin();
    assert.equal(guard.isCurrent(first), false);
    assert.equal(guard.isCurrent(second), true);
  });

  it("counts diff groups for summary cards", () => {
    const counts = countComparisonDiffGroups(sampleComparison());
    assert.deepEqual(counts, {
      newFacts: 1,
      changedFacts: 2,
      conflicts: 0,
      uncertainties: 0,
      suggestedUpdates: 1,
    });
  });

  it("formats confidence and tones without alarm colors", () => {
    assert.equal(formatMatchConfidencePercent(0.92), "92");
    assert.equal(resolveComparisonConfidenceTone(0.92), "high");
    assert.equal(resolveComparisonConfidenceTone(0.7), "medium");
    assert.equal(resolveComparisonConfidenceTone(0.3), "low");
  });

  it("builds article history links with supported version query", () => {
    assert.equal(
      buildArticleHistoryHref("article-1", 2),
      "/knowledge/articles/article-1/history?version=2",
    );
    assert.equal(
      buildArticleHistoryHref("article-1", null),
      "/knowledge/articles/article-1/history",
    );
  });

  it("expands only very small groups by default", () => {
    assert.equal(shouldExpandComparisonGroupByDefault(1), true);
    assert.equal(shouldExpandComparisonGroupByDefault(2), true);
    assert.equal(shouldExpandComparisonGroupByDefault(3), false);
  });
});
