import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AiAnalysisLanguage } from "@/lib/settings/ai-keys";

export const KNOWLEDGE_CLOUDFLARE_AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
export const KNOWLEDGE_CLOUDFLARE_AI_PROVIDER = "cloudflare_workers_ai";
export const KNOWLEDGE_ORGANIZE_SCHEMA_VERSION = "knowledge-organize-v1";
export const KNOWLEDGE_QA_SCHEMA_VERSION = "knowledge-qa-v1";

type CrmAiServiceResponse =
  | { ok: true; data: unknown; model: string }
  | { ok: false; error: string };

export type KnowledgeCloudflareAiFailureCategory =
  | "timeout"
  | "unavailable"
  | "invalid_response"
  | "rate_limited"
  | "internal";

export type KnowledgeCloudflareAiCallResult =
  | { ok: true; data: unknown; model: string }
  | { ok: false; category: KnowledgeCloudflareAiFailureCategory };

function mapCrmAiError(error: string): KnowledgeCloudflareAiFailureCategory {
  if (error === "timeout") return "timeout";
  if (error === "rate_limited") return "rate_limited";
  if (error === "invalid_output") return "invalid_response";
  if (error === "model_unavailable") return "unavailable";
  return "internal";
}

async function callKnowledgeCloudflareAi(
  body: Record<string, unknown>,
  aiService?: CloudflareEnv["AI_SERVICE"],
): Promise<KnowledgeCloudflareAiCallResult> {
  let fetcher = aiService;
  if (!fetcher) {
    try {
      const { env } = getCloudflareContext();
      fetcher = env.AI_SERVICE;
    } catch {
      return { ok: false, category: "unavailable" };
    }
  }

  if (!fetcher) {
    return { ok: false, category: "unavailable" };
  }

  let response: Response;
  try {
    response = await fetcher.fetch("https://crm-ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, category: "timeout" };
  }

  let payload: CrmAiServiceResponse;
  try {
    payload = (await response.json()) as CrmAiServiceResponse;
  } catch {
    return { ok: false, category: "invalid_response" };
  }

  if (payload.ok && payload.data !== undefined) {
    return {
      ok: true,
      data: payload.data,
      model: payload.model || KNOWLEDGE_CLOUDFLARE_AI_MODEL,
    };
  }

  if (!payload.ok && payload.error) {
    return { ok: false, category: mapCrmAiError(payload.error) };
  }

  return { ok: false, category: "invalid_response" };
}

export async function callKnowledgeOrganizeCloudflareAi(input: {
  locale: AiAnalysisLanguage;
  systemPrompt: string;
  userPrompt: string;
  aiService?: CloudflareEnv["AI_SERVICE"];
}): Promise<KnowledgeCloudflareAiCallResult> {
  return callKnowledgeCloudflareAi(
    {
      task: "knowledge_organize",
      schemaVersion: KNOWLEDGE_ORGANIZE_SCHEMA_VERSION,
      locale: input.locale,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
    },
    input.aiService,
  );
}

export async function callKnowledgeQaCloudflareAi(input: {
  locale: AiAnalysisLanguage;
  systemPrompt: string;
  userPrompt: string;
  aiService?: CloudflareEnv["AI_SERVICE"];
}): Promise<KnowledgeCloudflareAiCallResult> {
  return callKnowledgeCloudflareAi(
    {
      task: "knowledge_qa",
      schemaVersion: KNOWLEDGE_QA_SCHEMA_VERSION,
      locale: input.locale,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
    },
    input.aiService,
  );
}
