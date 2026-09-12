import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import {
  callKnowledgeCompareCloudflareAi,
  type KnowledgeCloudflareAiCallResult,
} from "@/lib/knowledge/cloudflare-knowledge-ai";
import type { AiAnalysisLanguage } from "@/lib/settings/ai-keys";

export class KnowledgeAiComparisonOutputError extends Error {
  constructor() {
    super("Knowledge comparison provider returned invalid JSON");
    this.name = "KnowledgeAiComparisonOutputError";
  }
}

export class KnowledgeAiComparisonTimeoutError extends Error {
  constructor() {
    super("Knowledge comparison provider timed out");
    this.name = "KnowledgeAiComparisonTimeoutError";
  }
}

function mapCloudflareFailure(
  result: Extract<KnowledgeCloudflareAiCallResult, { ok: false }>,
): never {
  if (result.category === "timeout") {
    throw new KnowledgeAiComparisonTimeoutError();
  }
  if (result.category === "invalid_response") {
    throw new KnowledgeAiComparisonOutputError();
  }
  throw new AiProviderError();
}

export async function callKnowledgeComparisonProvider(input: {
  locale: AiAnalysisLanguage;
  systemPrompt: string;
  userPrompt: string;
  aiService?: CloudflareEnv["AI_SERVICE"];
}): Promise<unknown> {
  const result = await callKnowledgeCompareCloudflareAi(input);
  if (!result.ok) {
    mapCloudflareFailure(result);
  }
  return result.data;
}
