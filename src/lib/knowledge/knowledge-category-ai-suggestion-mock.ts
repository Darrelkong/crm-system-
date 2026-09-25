import type { KnowledgeCategoryAiSuggestionContext } from "@/lib/knowledge/knowledge-category-ai-suggestion-prompt";
import type {
  KnowledgeCategoryAiCandidate,
  KnowledgeCategoryAiRawOutput,
} from "@/lib/knowledge/knowledge-category-ai-suggestion-schema";

const MOCK_MARKER_HIGH = /^@@knowledge-category-mock:high:(\d+)$/m;
const MOCK_MARKER_CONFIRM = /^@@knowledge-category-mock:confirm:(\d+)$/m;
const MOCK_MARKER_LOW = /^@@knowledge-category-mock:low\b/m;

export function mockKnowledgeCategoryAiSuggestion(input: {
  context: KnowledgeCategoryAiSuggestionContext;
  candidates: KnowledgeCategoryAiCandidate[];
}): KnowledgeCategoryAiRawOutput {
  const haystack = `${input.context.title}\n${input.context.summary}\n${input.context.body}`;
  const low = MOCK_MARKER_LOW.exec(haystack);
  if (low) {
    return {
      categoryId: null,
      confidenceBand: "low",
      reason: "mock_low_confidence",
    };
  }
  const confirm = MOCK_MARKER_CONFIRM.exec(haystack);
  if (confirm) {
    const index = Number(confirm[1]);
    const candidate = input.candidates[index];
    if (!candidate) {
      return { categoryId: null, confidenceBand: "low", reason: "mock_invalid_index" };
    }
    return {
      categoryId: candidate.id,
      confidenceBand: "medium",
      reason: "mock_requires_confirmation",
    };
  }
  const high = MOCK_MARKER_HIGH.exec(haystack);
  if (high) {
    const index = Number(high[1]);
    const candidate = input.candidates[index];
    if (!candidate) {
      return { categoryId: null, confidenceBand: "low", reason: "mock_invalid_index" };
    }
    return {
      categoryId: candidate.id,
      confidenceBand: "high",
      reason: "mock_high_confidence",
    };
  }
  if (input.candidates.length === 1) {
    return {
      categoryId: input.candidates[0]!.id,
      confidenceBand: "high",
      reason: "mock_single_candidate",
    };
  }
  return {
    categoryId: null,
    confidenceBand: "low",
    reason: "mock_unresolved",
  };
}
