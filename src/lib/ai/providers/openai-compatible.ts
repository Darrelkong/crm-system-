import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { buildProviderDiagnostics } from "@/lib/ai/customer-insights/diagnostics";
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

const PROVIDER_KIND = "openai_compatible" as const;

function extractMessageContent(
  data: ChatCompletionResponse,
  config: ProviderRuntimeConfig,
): string {
  const content = data.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new AiProviderError(
      buildProviderDiagnostics(config, PROVIDER_KIND, "provider_empty_content"),
    );
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
      throw new AiProviderError(
        buildProviderDiagnostics(
          config,
          PROVIDER_KIND,
          "provider_http_error",
          response.status,
        ),
      );
    }
    return extractMessageContent(data, config);
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }
    throw new AiProviderError(
      buildProviderDiagnostics(config, PROVIDER_KIND, "provider_request_failed"),
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonContent(content: string, config: ProviderRuntimeConfig): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    throw new AiProviderError(
      buildProviderDiagnostics(config, PROVIDER_KIND, "provider_json_parse_failed"),
    );
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
    return parseJsonContent(withFormat, config);
  } catch (firstError) {
    try {
      const withoutFormat = await postChatCompletion(config, baseBody);
      return parseJsonContent(withoutFormat, config);
    } catch (secondError) {
      if (secondError instanceof AiProviderError && secondError.diagnostics) {
        throw secondError;
      }
      if (firstError instanceof AiProviderError && firstError.diagnostics) {
        throw firstError;
      }
      throw secondError;
    }
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
