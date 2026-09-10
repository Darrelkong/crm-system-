import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import {
  callKnowledgeQaCloudflareAi,
  type KnowledgeCloudflareAiCallResult,
} from "@/lib/knowledge/cloudflare-knowledge-ai";
import type { AiAnalysisLanguage } from "@/lib/settings/ai-keys";
import {
  KnowledgeAiProviderOutputError,
  KnowledgeAiProviderTimeoutError,
} from "@/lib/knowledge/ai-organizer-provider";

function mapCloudflareFailure(
  result: Extract<KnowledgeCloudflareAiCallResult, { ok: false }>,
): never {
  if (result.category === "timeout") {
    throw new KnowledgeAiProviderTimeoutError();
  }
  if (result.category === "invalid_response") {
    throw new KnowledgeAiProviderOutputError();
  }
  throw new AiProviderError();
}

export async function callKnowledgeQaProvider(input: {
  locale: AiAnalysisLanguage;
  systemPrompt: string;
  userPrompt: string;
  aiService?: CloudflareEnv["AI_SERVICE"];
}) {
  const result = await callKnowledgeQaCloudflareAi(input);
  if (!result.ok) {
    mapCloudflareFailure(result);
  }
  return result.data;
}

export { KnowledgeAiProviderOutputError, KnowledgeAiProviderTimeoutError };
