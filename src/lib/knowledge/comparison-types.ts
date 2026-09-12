import type { KnowledgeAiComparisonRun } from "../../../drizzle/schema/knowledge-ai-comparison-runs";
import type { KnowledgeComparisonStoredResult } from "@/lib/knowledge/ai-comparison-schema";

export type ComparisonCandidateSnapshot = {
  candidateKey: string;
  articleId: string;
  articleVersionId: string;
  versionNumber: number;
  title: string;
  categoryName: string;
  preRank: number | null;
  preScore: number;
  postRank: number | null;
  postScore: number;
  combinedScore: number;
  bodyExcerptStart: number;
  bodyExcerptEnd: number;
};

export type KnowledgeComparisonDetail = {
  id: string;
  sourceId: string;
  organizationRunId: string;
  status: KnowledgeAiComparisonRun["status"];
  relationship: KnowledgeAiComparisonRun["relationship"];
  matchedArticleId: string | null;
  matchedArticleVersionId: string | null;
  matchedVersionNumber: number | null;
  matchConfidence: number | null;
  candidateSnapshot: ComparisonCandidateSnapshot[];
  comparison: KnowledgeComparisonStoredResult | null;
  degradationLevel: string | null;
  provider: string | null;
  model: string | null;
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
};
