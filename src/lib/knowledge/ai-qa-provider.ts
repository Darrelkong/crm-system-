import type { ProviderRuntimeConfig } from "@/lib/ai/providers/types";
import {
  callKnowledgeStructuredProvider,
  KnowledgeAiProviderOutputError,
  KnowledgeAiProviderTimeoutError,
} from "@/lib/knowledge/ai-organizer-provider";
import { KNOWLEDGE_AI_QA_JSON_SCHEMA } from "@/lib/knowledge/ai-qa-schema";

export async function callKnowledgeQaProvider(input: {
  kind: "openai_compatible" | "google_gemini";
  config: ProviderRuntimeConfig;
  systemPrompt: string;
  userPrompt: string;
}) {
  return callKnowledgeStructuredProvider({
    ...input,
    responseSchema: KNOWLEDGE_AI_QA_JSON_SCHEMA,
    responseSchemaName: "knowledge_grounded_answer",
  });
}

export { KnowledgeAiProviderOutputError, KnowledgeAiProviderTimeoutError };
