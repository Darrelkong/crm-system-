import type { Locale } from "@/i18n/config";
import type {
  KnowledgeComparisonDiffItem,
  KnowledgeComparisonSuggestedUpdate,
  KnowledgeComparisonStoredResult,
} from "@/lib/knowledge/ai-comparison-schema";
import type { KnowledgeComparisonDetail } from "@/lib/knowledge/comparison-types";
import { HONG_KONG_TIMEZONE, parseUtcDate } from "@/lib/timezone";

/** Bounded client wait for comparison POST/refresh in Preview and ingest UI. */
export const KNOWLEDGE_COMPARISON_CLIENT_TIMEOUT_MS = 30_000;

export class KnowledgeComparisonClientTimeoutError extends Error {
  constructor() {
    super("Knowledge comparison client timeout");
    this.name = "KnowledgeComparisonClientTimeoutError";
  }
}

export function isKnowledgeComparisonClientTimeoutError(
  error: unknown,
): boolean {
  return error instanceof KnowledgeComparisonClientTimeoutError;
}

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

function normalizeDiffItem(item: KnowledgeComparisonDiffItem) {
  return {
    topic: item.topic,
    existingValue: item.existingValue,
    incomingValue: item.incomingValue,
    explanation: item.explanation,
    confidence: item.confidence,
    sourceExcerpt: item.sourceExcerpt,
    existingExcerpt: item.existingExcerpt,
  };
}

function normalizeSuggestedUpdate(item: KnowledgeComparisonSuggestedUpdate) {
  return {
    topic: item.topic,
    suggestion: item.suggestion,
    rationale: item.rationale,
    confidence: item.confidence,
  };
}

function sortByTopic<T extends { topic?: string | null }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    (left.topic ?? "").localeCompare(right.topic ?? ""),
  );
}

function normalizeComparisonPayload(
  payload: KnowledgeComparisonStoredResult | null,
): string {
  if (!payload) return "null";
  return JSON.stringify({
    relationship: payload.relationship,
    matchedCandidateKey: payload.matchedCandidateKey,
    matchConfidence: payload.matchConfidence,
    degradationLevel: payload.degradationLevel ?? null,
    newFacts: sortByTopic(payload.newFacts.map(normalizeDiffItem)),
    changedFacts: sortByTopic(payload.changedFacts.map(normalizeDiffItem)),
    conflicts: sortByTopic(payload.conflicts.map(normalizeDiffItem)),
    uncertainties: sortByTopic(payload.uncertainties.map(normalizeDiffItem)),
    suggestedUpdates: sortByTopic(
      payload.suggestedUpdates.map(normalizeSuggestedUpdate),
    ),
  });
}

function buildSemanticComparisonFingerprint(
  comparison: KnowledgeComparisonDetail,
): string {
  return JSON.stringify({
    relationship: comparison.relationship,
    matchedArticleId: comparison.matchedArticleId,
    matchedArticleVersionId: comparison.matchedArticleVersionId,
    matchedVersionNumber: comparison.matchedVersionNumber,
    matchConfidence: comparison.matchConfidence,
    degradationLevel: comparison.degradationLevel,
    comparison: normalizeComparisonPayload(comparison.comparison),
  });
}

/** Compare user-visible comparison output, ignoring run metadata. */
export function areKnowledgeComparisonsSemanticallyEqual(
  previous: KnowledgeComparisonDetail | null,
  next: KnowledgeComparisonDetail | null,
): boolean {
  if (!previous || !next) return previous === next;
  if (previous.status !== "completed" || next.status !== "completed") {
    return false;
  }
  return (
    buildSemanticComparisonFingerprint(previous) ===
    buildSemanticComparisonFingerprint(next)
  );
}

export function shouldBlockManualRecompare(input: {
  inFlight: boolean;
  comparing: boolean;
}): boolean {
  return input.inFlight || input.comparing;
}

function resolveIntlLocale(locale: Locale): string {
  switch (locale) {
    case "zh-Hant":
      return "zh-Hant-HK";
    case "zh-Hans":
      return "zh-Hans-CN";
    default:
      return "en-GB";
  }
}

export function formatKnowledgeComparisonLastComparedAt(
  value: string | null | undefined,
  locale: Locale,
  fallback = "—",
): string {
  const date = parseUtcDate(value);
  if (!date) return fallback;
  try {
    return new Intl.DateTimeFormat(resolveIntlLocale(locale), {
      timeZone: HONG_KONG_TIMEZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: locale !== "en",
    }).format(date);
  } catch {
    return fallback;
  }
}
