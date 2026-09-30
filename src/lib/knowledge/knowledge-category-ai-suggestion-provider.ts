import { allowMockDeepInsightGeneration } from "@/lib/ai/providers/mock-constants";
import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import {
  callKnowledgeCategorySuggestCloudflareAi,
  type KnowledgeCloudflareAiCallResult,
} from "@/lib/knowledge/cloudflare-knowledge-ai";
import { mockKnowledgeCategoryAiSuggestion } from "@/lib/knowledge/knowledge-category-ai-suggestion-mock";
import {
  buildKnowledgeCategoryAiSuggestionSystemPrompt,
  buildKnowledgeCategoryAiSuggestionUserPrompt,
  type KnowledgeCategoryAiSuggestionContext,
} from "@/lib/knowledge/knowledge-category-ai-suggestion-prompt";
import {
  parseKnowledgeCategoryAiRawOutput,
  type KnowledgeCategoryAiCandidate,
} from "@/lib/knowledge/knowledge-category-ai-suggestion-schema";
import { KNOWLEDGE_ARTICLE_CONTENT_LOCALE } from "@/lib/knowledge/constants";

export class KnowledgeCategoryAiProviderOutputError extends Error {
  constructor() {
    super("Knowledge category AI provider returned invalid JSON");
    this.name = "KnowledgeCategoryAiProviderOutputError";
  }
}

export class KnowledgeCategoryAiProviderTimeoutError extends Error {
  constructor() {
    super("Knowledge category AI provider timed out");
    this.name = "KnowledgeCategoryAiProviderTimeoutError";
  }
}

function mapCloudflareFailure(
  result: Extract<KnowledgeCloudflareAiCallResult, { ok: false }>,
): never {
  if (result.category === "timeout") {
    throw new KnowledgeCategoryAiProviderTimeoutError();
  }
  if (result.category === "invalid_response") {
    throw new KnowledgeCategoryAiProviderOutputError();
  }
  throw new AiProviderError();
}

export async function callKnowledgeCategorySuggestionProvider(input: {
  context: KnowledgeCategoryAiSuggestionContext;
  candidates: KnowledgeCategoryAiCandidate[];
  aiService?: CloudflareEnv["AI_SERVICE"];
}): Promise<unknown> {
  if (allowMockDeepInsightGeneration()) {
    return mockKnowledgeCategoryAiSuggestion(input);
  }
  const systemPrompt = buildKnowledgeCategoryAiSuggestionSystemPrompt();
  const userPrompt = buildKnowledgeCategoryAiSuggestionUserPrompt(input);
  const result = await callKnowledgeCategorySuggestCloudflareAi({
    locale: KNOWLEDGE_ARTICLE_CONTENT_LOCALE,
    systemPrompt,
    userPrompt,
    aiService: input.aiService,
  });
  if (!result.ok) {
    mapCloudflareFailure(result);
  }
  return result.data;
}

export async function fetchKnowledgeCategoryAiRawOutput(input: {
  context: KnowledgeCategoryAiSuggestionContext;
  candidates: KnowledgeCategoryAiCandidate[];
  aiService?: CloudflareEnv["AI_SERVICE"];
}) {
  const raw = await callKnowledgeCategorySuggestionProvider(input);
  return parseKnowledgeCategoryAiRawOutput(raw);
}
