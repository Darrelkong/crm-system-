import { asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { fetchKnowledgeCategoryAiRawOutput } from "@/lib/knowledge/knowledge-category-ai-suggestion-provider";
import type { KnowledgeCategoryAiSuggestionContext } from "@/lib/knowledge/knowledge-category-ai-suggestion-prompt";
import type {
  KnowledgeCategoryAiCandidate,
  KnowledgeCategoryAiSuggestionResult,
} from "@/lib/knowledge/knowledge-category-ai-suggestion-schema";

/** V1: send all active categories (typical tenant size is small). */
export const KNOWLEDGE_CATEGORY_AI_CANDIDATE_CAP = 200;

/**
 * Confidence policy (V1, conservative):
 * - high: auto-prefill categoryId (still editable)
 * - medium: show suggestion; human must confirm before draft save
 * - low / null categoryId: unresolved, manual selection required
 */
export async function listActiveKnowledgeCategoryCandidates(
  db: Database = getDb(),
): Promise<KnowledgeCategoryAiCandidate[]> {
  const rows = await db
    .select({
      id: schema.knowledgeCategories.id,
      name: schema.knowledgeCategories.name,
      description: schema.knowledgeCategories.description,
    })
    .from(schema.knowledgeCategories)
    .where(eq(schema.knowledgeCategories.isActive, true))
    .orderBy(
      asc(schema.knowledgeCategories.sortOrder),
      asc(schema.knowledgeCategories.name),
    )
    .limit(KNOWLEDGE_CATEGORY_AI_CANDIDATE_CAP);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
  }));
}

export function finalizeKnowledgeCategoryAiSuggestion(input: {
  raw: {
    categoryId: string | null;
    confidenceBand: "high" | "medium" | "low";
    reason?: string;
  } | null;
  candidates: KnowledgeCategoryAiCandidate[];
}): KnowledgeCategoryAiSuggestionResult {
  if (!input.raw) {
    return {
      status: "invalid_output",
      resolutionSource: null,
      requiresConfirmation: false,
    };
  }
  if (!input.raw.categoryId) {
    return {
      status: "insufficient_confidence",
      confidenceBand: input.raw.confidenceBand,
      reason: input.raw.reason,
      resolutionSource: null,
      requiresConfirmation: false,
    };
  }
  const raw = input.raw;
  const candidate = input.candidates.find((item) => item.id === raw.categoryId);
  if (!candidate) {
    return {
      status: "invalid_output",
      reason: "category_not_in_candidate_list",
      resolutionSource: null,
      requiresConfirmation: false,
    };
  }
  if (input.raw.confidenceBand === "low") {
    return {
      status: "insufficient_confidence",
      confidenceBand: "low",
      reason: input.raw.reason,
      resolutionSource: null,
      requiresConfirmation: false,
    };
  }
  const requiresConfirmation = input.raw.confidenceBand === "medium";
  return {
    status: "suggested",
    categoryId: candidate.id,
    categoryName: candidate.name,
    confidenceBand: input.raw.confidenceBand,
    reason: input.raw.reason,
    resolutionSource: "ai_suggestion",
    requiresConfirmation,
  };
}

export async function suggestKnowledgeCategoryForOrganizer(
  context: KnowledgeCategoryAiSuggestionContext,
  db: Database = getDb(),
  aiService?: CloudflareEnv["AI_SERVICE"],
): Promise<KnowledgeCategoryAiSuggestionResult> {
  const candidates = await listActiveKnowledgeCategoryCandidates(db);
  if (candidates.length === 0) {
    return {
      status: "no_categories",
      resolutionSource: null,
      requiresConfirmation: false,
    };
  }
  try {
    const raw = await fetchKnowledgeCategoryAiRawOutput({
      context,
      candidates,
      aiService,
    });
    return finalizeKnowledgeCategoryAiSuggestion({ raw, candidates });
  } catch {
    return {
      status: "error",
      resolutionSource: null,
      requiresConfirmation: false,
    };
  }
}
