/** Canonical in-app path for a Knowledge article draft/detail view. */
export function knowledgeArticleDetailPath(articleId: string): string {
  return `/knowledge/articles/${articleId}`;
}

export function resolveCandidateDraftArticleId(
  candidate: { id: string; draftArticleId?: string | null },
  savedArticleIds: Record<string, string>,
): string | null {
  const raw = savedArticleIds[candidate.id] ?? candidate.draftArticleId;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function candidateShowsConvertedWithoutDraftId(candidate: {
  draftArticleId?: string | null;
  convertedAt?: string | null;
}): boolean {
  return Boolean(candidate.convertedAt) && !candidate.draftArticleId;
}
