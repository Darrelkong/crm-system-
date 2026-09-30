import type { ComparedOrganizerDraftSnapshot } from "@/lib/knowledge/comparison-types";
import type { KnowledgeComparisonStoredResult } from "@/lib/knowledge/ai-comparison-schema";

export function hasUsableComparedOrganizerDraft(
  draft: ComparedOrganizerDraftSnapshot,
): boolean {
  return (
    draft.title.length > 0 && draft.summary.length > 0 && draft.body.length > 0
  );
}

export function normalizeComparedOrganizerDraft(input: {
  title: string;
  summary: string;
  body: string;
}): ComparedOrganizerDraftSnapshot {
  return {
    title: input.title.trim(),
    summary: input.summary.trim(),
    body: input.body.trim(),
  };
}

export function comparedOrganizerDraftFingerprint(
  draft: ComparedOrganizerDraftSnapshot,
): string {
  return JSON.stringify([
    draft.title,
    draft.summary,
    draft.body,
  ]);
}

export function comparisonMatchesOrganizerDraft(
  comparison: KnowledgeComparisonStoredResult | null,
  draft: ComparedOrganizerDraftSnapshot,
): boolean {
  if (!comparison?.comparedOrganizerDraft) return false;
  return (
    comparedOrganizerDraftFingerprint(comparison.comparedOrganizerDraft) ===
    comparedOrganizerDraftFingerprint(draft)
  );
}

export function isCandidateComparisonStale(
  comparison: KnowledgeComparisonStoredResult | null,
  draft: ComparedOrganizerDraftSnapshot,
): boolean {
  if (!comparison) return true;
  if (comparison.relationship === undefined) return true;
  return !comparisonMatchesOrganizerDraft(comparison, draft);
}
