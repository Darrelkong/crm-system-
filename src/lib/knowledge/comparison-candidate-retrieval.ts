import type { Database } from "@/lib/db";
import { getDb } from "@/lib/db";
import {
  retrievePublishedKnowledge,
  type PublishedKnowledgeDocument,
} from "@/lib/knowledge/published-retrieval";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";

export const KNOWLEDGE_COMPARISON_PRE_RETRIEVAL_LIMIT = 5;
export const KNOWLEDGE_COMPARISON_POST_RETRIEVAL_LIMIT = 5;
export const KNOWLEDGE_COMPARISON_FINAL_CANDIDATE_MAX = 3;
export const KNOWLEDGE_COMPARISON_SOURCE_EXCERPT_MAX_CHARS = 2_000;
export const KNOWLEDGE_COMPARISON_ORGANIZER_BODY_EXCERPT_MAX_CHARS = 2_000;

/** Pre-shortlist rank points: 1st=5 … 5th=1 */
export const KNOWLEDGE_COMPARISON_PRE_RANK_POINTS = [5, 4, 3, 2, 1] as const;

/** Post-organizer rank points: 1st=10 … 5th=2 */
export const KNOWLEDGE_COMPARISON_POST_RANK_POINTS = [10, 8, 6, 4, 2] as const;

export type ComparisonCandidate = {
  candidateKey: string;
  articleId: string;
  articleVersionId: string;
  versionNumber: number;
  title: string;
  summary: string | null;
  categoryName: string;
  visibility: PublishedKnowledgeDocument["visibility"];
  bodyExcerpt: string;
  bodyExcerptStart: number;
  bodyExcerptEnd: number;
  preRank: number | null;
  preScore: number;
  postRank: number | null;
  postScore: number;
  combinedScore: number;
};

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function buildSourcePreRetrievalQuery(input: {
  sourceTitle: string | null;
  rawText: string;
}): string {
  const title = input.sourceTitle?.trim() ?? "";
  const excerpt = normalizeWhitespace(
    input.rawText.slice(0, KNOWLEDGE_COMPARISON_SOURCE_EXCERPT_MAX_CHARS),
  );
  const combined = [title, excerpt].filter(Boolean).join(" ");
  return combined.slice(0, 200);
}

export function buildOrganizerPostRetrievalQuery(input: {
  proposedTitle: string | null;
  proposedSummary: string | null;
  proposedCategory: string | null;
  proposedBody: string | null;
}): string {
  const bodyExcerpt = normalizeWhitespace(
    (input.proposedBody ?? "").slice(
      0,
      KNOWLEDGE_COMPARISON_ORGANIZER_BODY_EXCERPT_MAX_CHARS,
    ),
  );
  const parts = [
    input.proposedTitle?.trim(),
    input.proposedSummary?.trim(),
    input.proposedCategory?.trim(),
    bodyExcerpt,
  ].filter(Boolean);
  return parts.join(" ").slice(0, 200);
}

function excerptBounds(
  body: string,
  query: string,
  maxChars: number,
): { excerpt: string; start: number; end: number } {
  if (body.length <= maxChars) {
    return { excerpt: body, start: 0, end: body.length };
  }
  const lower = body.toLocaleLowerCase();
  const tokens =
    query
      .toLocaleLowerCase()
      .match(/[\p{Letter}\p{Number}]+/gu)
      ?.slice(0, 8) ?? [];
  const matchIndex = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const center = matchIndex ?? 0;
  const start = Math.max(
    0,
    Math.min(center - Math.floor(maxChars / 3), body.length - maxChars),
  );
  const end = Math.min(body.length, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return {
    excerpt: `${prefix}${body.slice(start, end)}${suffix}`,
    start,
    end,
  };
}

type RankedDocument = {
  document: PublishedKnowledgeDocument;
  rank: number;
  score: number;
};

function rankDocuments(
  documents: PublishedKnowledgeDocument[],
  points: readonly number[],
): RankedDocument[] {
  return documents.map((document, index) => ({
    document,
    rank: index + 1,
    score: points[index] ?? 0,
  }));
}

/**
 * Deterministic merge of pre- and post-organizer retrieval shortlists.
 *
 * Sort order:
 * 1. combinedScore descending
 * 2. postRank ascending (lower rank = better; null ranks last)
 * 3. preRank ascending
 * 4. articleId ascending
 */
export function mergeComparisonCandidates(
  preDocuments: PublishedKnowledgeDocument[],
  postDocuments: PublishedKnowledgeDocument[],
  queryForExcerpt: string,
  bodyExcerptMaxChars = 4_000,
): ComparisonCandidate[] {
  const preRanked = rankDocuments(
    preDocuments.slice(0, KNOWLEDGE_COMPARISON_PRE_RETRIEVAL_LIMIT),
    KNOWLEDGE_COMPARISON_PRE_RANK_POINTS,
  );
  const postRanked = rankDocuments(
    postDocuments.slice(0, KNOWLEDGE_COMPARISON_POST_RETRIEVAL_LIMIT),
    KNOWLEDGE_COMPARISON_POST_RANK_POINTS,
  );

  const byArticle = new Map<
    string,
    {
      document: PublishedKnowledgeDocument;
      preRank: number | null;
      preScore: number;
      postRank: number | null;
      postScore: number;
    }
  >();

  for (const entry of preRanked) {
    byArticle.set(entry.document.articleId, {
      document: entry.document,
      preRank: entry.rank,
      preScore: entry.score,
      postRank: null,
      postScore: 0,
    });
  }

  for (const entry of postRanked) {
    const existing = byArticle.get(entry.document.articleId);
    if (existing) {
      existing.postRank = entry.rank;
      existing.postScore = entry.score;
      existing.document = entry.document;
    } else {
      byArticle.set(entry.document.articleId, {
        document: entry.document,
        preRank: null,
        preScore: 0,
        postRank: entry.rank,
        postScore: entry.score,
      });
    }
  }

  const merged = Array.from(byArticle.values())
    .map((entry) => ({
      ...entry,
      combinedScore: entry.preScore + entry.postScore,
    }))
    .sort((left, right) => {
      if (right.combinedScore !== left.combinedScore) {
        return right.combinedScore - left.combinedScore;
      }
      const leftPost = left.postRank ?? Number.MAX_SAFE_INTEGER;
      const rightPost = right.postRank ?? Number.MAX_SAFE_INTEGER;
      if (leftPost !== rightPost) return leftPost - rightPost;
      const leftPre = left.preRank ?? Number.MAX_SAFE_INTEGER;
      const rightPre = right.preRank ?? Number.MAX_SAFE_INTEGER;
      if (leftPre !== rightPre) return leftPre - rightPre;
      return left.document.articleId.localeCompare(right.document.articleId);
    })
    .slice(0, KNOWLEDGE_COMPARISON_FINAL_CANDIDATE_MAX);

  return merged.map((entry, index) => {
    const bounds = excerptBounds(
      entry.document.body,
      queryForExcerpt,
      bodyExcerptMaxChars,
    );
    return {
      candidateKey: `C${index + 1}`,
      articleId: entry.document.articleId,
      articleVersionId: entry.document.articleVersionId,
      versionNumber: entry.document.versionNumber,
      title: entry.document.title,
      summary: entry.document.summary,
      categoryName: entry.document.categoryName,
      visibility: entry.document.visibility,
      bodyExcerpt: bounds.excerpt,
      bodyExcerptStart: bounds.start,
      bodyExcerptEnd: bounds.end,
      preRank: entry.preRank,
      preScore: entry.preScore,
      postRank: entry.postRank,
      postScore: entry.postScore,
      combinedScore: entry.combinedScore,
    };
  });
}

export async function retrieveComparisonCandidates(
  context: KnowledgeSessionContext,
  input: {
    sourceTitle: string | null;
    rawText: string;
    proposedTitle: string | null;
    proposedSummary: string | null;
    proposedCategory: string | null;
    proposedBody: string | null;
  },
  db: Database = getDb(),
): Promise<ComparisonCandidate[]> {
  const preQuery = buildSourcePreRetrievalQuery({
    sourceTitle: input.sourceTitle,
    rawText: input.rawText,
  });
  const postQuery = buildOrganizerPostRetrievalQuery({
    proposedTitle: input.proposedTitle,
    proposedSummary: input.proposedSummary,
    proposedCategory: input.proposedCategory,
    proposedBody: input.proposedBody,
  });

  const preDocuments =
    preQuery.trim().length > 0
      ? await retrievePublishedKnowledge(
          context,
          preQuery,
          { limit: KNOWLEDGE_COMPARISON_PRE_RETRIEVAL_LIMIT },
          db,
        )
      : [];
  const postDocuments =
    postQuery.trim().length > 0
      ? await retrievePublishedKnowledge(
          context,
          postQuery,
          { limit: KNOWLEDGE_COMPARISON_POST_RETRIEVAL_LIMIT },
          db,
        )
      : [];

  return mergeComparisonCandidates(preDocuments, postDocuments, postQuery || preQuery);
}
