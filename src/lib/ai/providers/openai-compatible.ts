import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { buildProviderDiagnostics } from "@/lib/ai/customer-insights/diagnostics";
import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import { CUSTOMER_INSIGHT_JSON_SCHEMA } from "@/lib/ai/customer-insights/json-schema";
import {
  AI_PROVIDER_MAX_RESPONSE_CHARS,
  AI_PROVIDER_SCANNER_MAX_CANDIDATES,
} from "@/lib/ai/customer-insights/limits";
import {
  buildSystemPrompt,
  buildUserPrompt,
  serializeCustomerInsightContext,
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
    const content = extractMessageContent(data, config);
    if (content.length > AI_PROVIDER_MAX_RESPONSE_CHARS) {
      throw new AiProviderError(
        buildProviderDiagnostics(
          config,
          PROVIDER_KIND,
          "provider_response_too_large",
          undefined,
          { contentLength: content.length },
        ),
      );
    }
    return content;
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

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractFencedJsonCandidates(content: string): string[] {
  const candidates: string[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  for (const match of content.matchAll(fencePattern)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function findBalancedJsonObjectEnd(
  text: string,
  startIndex: number,
): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return null;
}

function extractBalancedJsonObjectCandidates(content: string): string[] {
  const candidates: string[] = [];
  for (
    let start = content.indexOf("{");
    start !== -1 && candidates.length < AI_PROVIDER_SCANNER_MAX_CANDIDATES;
    start = content.indexOf("{", start + 1)
  ) {
    const end = findBalancedJsonObjectEnd(content, start);
    if (end !== null) {
      candidates.push(content.slice(start, end + 1));
    }
  }
  return candidates;
}

function parseJsonContent(content: string, config: ProviderRuntimeConfig): unknown {
  const trimmed = content.trim();
  const raw = tryParseJson(trimmed);
  if (raw !== null) {
    return raw;
  }

  for (const candidate of extractFencedJsonCandidates(trimmed)) {
    const parsed = tryParseJson(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  for (const candidate of extractBalancedJsonObjectCandidates(trimmed)) {
    const parsed = tryParseJson(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  const firstNonWhitespaceChar = trimmed[0];
  throw new AiProviderError(
    buildProviderDiagnostics(
      config,
      PROVIDER_KIND,
      "provider_json_parse_failed",
      undefined,
      {
        contentLength: content.length,
        parseStrategy: "none",
        ...(firstNonWhitespaceChar ? { firstNonWhitespaceChar } : {}),
      },
    ),
  );
}

/**
 * Returns true when a fallback attempt with json_object response_format is worth trying.
 * Parse failures and oversized responses indicate the content itself is the
 * problem — retrying with a weaker format parameter will not help and doubles
 * the CPU cost of the request.
 */
function shouldAttemptFormatFallback(error: unknown): boolean {
  if (!(error instanceof AiProviderError) || !error.diagnostics) {
    return true;
  }
  const t = error.diagnostics.providerErrorType;
  return t !== "provider_json_parse_failed" && t !== "provider_response_too_large";
}

async function requestStructuredJson(
  config: ProviderRuntimeConfig,
  settings: EffectiveAiSettings,
  context: CustomerInsightContext,
): Promise<unknown> {
  const contextJson = serializeCustomerInsightContext(context);
  const contextLength = contextJson.length;
  const userPrompt = buildUserPrompt(settings.aiPromptTemplate, context);
  const promptLength = userPrompt.length;

  const messages = [
    { role: "system", content: buildSystemPrompt(settings.aiAnalysisLanguage) },
    { role: "user", content: userPrompt },
  ];

  const baseBody = {
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages,
  };

  const startMs = Date.now();

  function enrichError(error: unknown, usedFallback: boolean): AiProviderError {
    const durationMs = Date.now() - startMs;
    if (error instanceof AiProviderError && error.diagnostics) {
      return new AiProviderError(
        { ...error.diagnostics, contextLength, promptLength, durationMs, usedFallback },
        error.message,
      );
    }
    return error instanceof AiProviderError ? error : new AiProviderError(undefined);
  }

  try {
    const withJsonSchema = await postChatCompletion(config, {
      ...baseBody,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "customer_insight",
          schema: CUSTOMER_INSIGHT_JSON_SCHEMA,
        },
      },
    });
    return parseJsonContent(withJsonSchema, config);
  } catch (firstError) {
    if (!shouldAttemptFormatFallback(firstError)) {
      throw enrichError(firstError, false);
    }
    try {
      const withJsonObject = await postChatCompletion(config, {
        ...baseBody,
        response_format: { type: "json_object" },
      });
      return parseJsonContent(withJsonObject, config);
    } catch (secondError) {
      throw enrichError(secondError, true);
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
