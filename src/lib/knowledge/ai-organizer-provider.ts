import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import {
  callKnowledgeOrganizeCloudflareAi,
  type KnowledgeCloudflareAiCallResult,
} from "@/lib/knowledge/cloudflare-knowledge-ai";
import type { AiAnalysisLanguage } from "@/lib/settings/ai-keys";

export class KnowledgeAiProviderOutputError extends Error {
  constructor() {
    super("Knowledge AI provider returned invalid JSON");
    this.name = "KnowledgeAiProviderOutputError";
  }
}

export class KnowledgeAiProviderTimeoutError extends Error {
  constructor() {
    super("Knowledge AI provider timed out");
    this.name = "KnowledgeAiProviderTimeoutError";
  }
}

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

export async function callKnowledgeOrganizationProvider(input: {
  locale: AiAnalysisLanguage;
  systemPrompt: string;
  userPrompt: string;
  aiService?: CloudflareEnv["AI_SERVICE"];
}): Promise<unknown> {
  const result = await callKnowledgeOrganizeCloudflareAi(input);
  if (!result.ok) {
    mapCloudflareFailure(result);
  }
  return result.data;
}

export async function callKnowledgeStructuredProvider(input: {
  locale: AiAnalysisLanguage;
  systemPrompt: string;
  userPrompt: string;
  aiService?: CloudflareEnv["AI_SERVICE"];
}): Promise<unknown> {
  return callKnowledgeOrganizationProvider(input);
}
