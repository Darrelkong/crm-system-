import type { KnowledgeComparisonDetail } from "@/lib/knowledge/comparison-types";

export function createKnowledgeComparisonRequestGuard() {
  let currentRequestId = 0;
  return {
    begin(): number {
      currentRequestId += 1;
      return currentRequestId;
    },
    isCurrent(requestId: number): boolean {
      return requestId === currentRequestId;
    },
  };
}

export function shouldAutoCompareAfterOrganize(input: {
  canExecute: boolean;
  organizationReady: boolean;
  sourceStatus: string | null;
  sourceId: string | null;
  autoCompareAttemptedForSourceId: string | null;
}): boolean {
  if (!input.canExecute || !input.organizationReady || !input.sourceId) {
    return false;
  }
  if (input.sourceStatus !== "organized") return false;
  return input.autoCompareAttemptedForSourceId !== input.sourceId;
}

export function isComparisonProcessing(
  comparison: KnowledgeComparisonDetail | null,
): boolean {
  return (
    comparison?.status === "pending" || comparison?.status === "processing"
  );
}

export function isComparisonFailed(
  comparison: KnowledgeComparisonDetail | null,
): boolean {
  return comparison?.status === "failed";
}

export function isComparisonCompleted(
  comparison: KnowledgeComparisonDetail | null,
): boolean {
  return comparison?.status === "completed";
}

export type KnowledgeComparisonDiffCounts = {
  newFacts: number;
  changedFacts: number;
  conflicts: number;
  uncertainties: number;
  suggestedUpdates: number;
};

export function countComparisonDiffGroups(
  comparison: KnowledgeComparisonDetail | null,
): KnowledgeComparisonDiffCounts {
  const payload = comparison?.comparison;
  return {
    newFacts: payload?.newFacts.length ?? 0,
    changedFacts: payload?.changedFacts.length ?? 0,
    conflicts: payload?.conflicts.length ?? 0,
    uncertainties: payload?.uncertainties.length ?? 0,
    suggestedUpdates: payload?.suggestedUpdates.length ?? 0,
  };
}

export function formatMatchConfidencePercent(
  confidence: number | null | undefined,
): string | null {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  const percent = Math.round(confidence * 100);
  return String(Math.min(100, Math.max(0, percent)));
}

export type KnowledgeComparisonConfidenceTone = "high" | "medium" | "low";

export function resolveComparisonConfidenceTone(
  confidence: number | null | undefined,
): KnowledgeComparisonConfidenceTone {
  if (confidence == null || !Number.isFinite(confidence)) return "low";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}

export function buildArticleHistoryHref(
  articleId: string,
  versionNumber: number | null,
): string {
  if (versionNumber == null) {
    return `/knowledge/articles/${articleId}/history`;
  }
  return `/knowledge/articles/${articleId}/history?version=${versionNumber}`;
}

export function resolveMatchedArticleTitle(
  comparison: KnowledgeComparisonDetail,
): string | null {
  if (!comparison.matchedArticleVersionId) return null;
  const candidate = comparison.candidateSnapshot.find(
    (item) => item.articleVersionId === comparison.matchedArticleVersionId,
  );
  return candidate?.title ?? null;
}

export function shouldExpandComparisonGroupByDefault(count: number): boolean {
  return count > 0 && count <= 2;
}
