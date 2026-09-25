import { z } from "zod";

export const KNOWLEDGE_CATEGORY_SUGGEST_SCHEMA_VERSION =
  "knowledge-category-suggest-v1";

export const knowledgeCategoryAiRawOutputSchema = z.object({
  categoryId: z.string().uuid().nullable(),
  confidenceBand: z.enum(["high", "medium", "low"]),
  reason: z.string().max(500).optional(),
});

export type KnowledgeCategoryAiRawOutput = z.infer<
  typeof knowledgeCategoryAiRawOutputSchema
>;

export type KnowledgeCategoryAiSuggestionStatus =
  | "suggested"
  | "insufficient_confidence"
  | "no_categories"
  | "invalid_output"
  | "error";

export type KnowledgeCategoryAiSuggestionResult = {
  status: KnowledgeCategoryAiSuggestionStatus;
  categoryId?: string;
  categoryName?: string;
  confidenceBand?: "high" | "medium" | "low";
  reason?: string;
  resolutionSource: "ai_suggestion" | null;
  requiresConfirmation: boolean;
};

export type KnowledgeCategoryAiCandidate = {
  id: string;
  name: string;
  description: string | null;
};

export function parseKnowledgeCategoryAiRawOutput(
  value: unknown,
): KnowledgeCategoryAiRawOutput | null {
  const parsed = knowledgeCategoryAiRawOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
