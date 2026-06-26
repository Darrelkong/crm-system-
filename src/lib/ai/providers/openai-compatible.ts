import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import {
  buildSystemPrompt,
  buildUserPrompt,
} from "@/lib/ai/customer-insights/prompt-builder";
import { validateAiApiBaseUrl } from "@/lib/settings/ai-validation";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import type { CustomerInsightAIProvider, ProviderRuntimeConfig } from "./types";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

function extractMessageContent(data: ChatCompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new AiProviderError();
  }
  return content.trim();
}

export function buildChatCompletionsUrl(apiBaseUrl: string): string {
  const normalized = apiBaseUrl.trim().replace(/\/+$/, "");

  try {
    const url = new URL(normalized);
    if (
      url.hostname.includes("generativelanguage.googleapis.com") &&
      url.pathname.includes("/openai")
    ) {
      return `${normalized}/chat/completions`;
    }
  } catch {
    // Fall through to OpenAI-style path for non-URL inputs.
  }

  return `${normalized}/v1/chat/completions`;
}

async function postChatCompletion(
  config: ProviderRuntimeConfig,
  body: Record<string, unknown>,
): Promise<string> {
  if (validateAiApiBaseUrl(config.apiBaseUrl)) {
    throw new AiProviderError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(buildChatCompletionsUrl(config.apiBaseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await response.json()) as ChatCompletionResponse;
    if (!response.ok) {
      throw new AiProviderError();
    }
    return extractMessageContent(data);
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }
    throw new AiProviderError();
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    throw new AiProviderError();
  }
}

async function requestStructuredJson(
  config: ProviderRuntimeConfig,
  settings: EffectiveAiSettings,
  context: CustomerInsightContext,
): Promise<unknown> {
  const messages = [
    { role: "system", content: buildSystemPrompt(settings.aiAnalysisLanguage) },
    {
      role: "user",
      content: buildUserPrompt(settings.aiPromptTemplate, context),
    },
  ];

  const baseBody = {
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages,
  };

  try {
    const withFormat = await postChatCompletion(config, {
      ...baseBody,
      response_format: { type: "json_object" },
    });
    return parseJsonContent(withFormat);
  } catch {
    const withoutFormat = await postChatCompletion(config, baseBody);
    return parseJsonContent(withoutFormat);
  }
}

export const openAiCompatibleCustomerInsightProvider: CustomerInsightAIProvider = {
  kind: "openai_compatible",

  async analyzeCustomerInsight(context, _settings, config) {
    if (!config) {
      throw new AiProviderError();
    }
    return requestStructuredJson(config, _settings, context);
  },
};
