import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import type {
  AiProviderDiagnostics,
  AiProviderErrorType,
} from "@/lib/ai/customer-insights/diagnostics";
import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import { CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA } from "@/lib/ai/customer-insights/json-schema";
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

const PROVIDER_KIND = "google_gemini" as const;

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
      role?: string;
    };
    finishReason?: string;
  }>;
};

export function buildGeminiGenerateUrl(apiBaseUrl: string, model: string): string {
  const normalized = apiBaseUrl.trim().replace(/\/+$/, "");
  return `${normalized}/models/${encodeURIComponent(model)}:generateContent`;
}

function buildGeminiDiagnostics(
  config: ProviderRuntimeConfig,
  providerErrorType: AiProviderErrorType,
  httpStatus?: number,
  safeDetails?: Pick<
    AiProviderDiagnostics,
    "contentLength" | "parseStrategy" | "firstNonWhitespaceChar"
  >,
): AiProviderDiagnostics {
  let requestUrlHost: string | undefined;
  let requestUrlPath: string | undefined;
  try {
    const endpointUrl = buildGeminiGenerateUrl(config.apiBaseUrl, config.model);
    const parsed = new URL(endpointUrl);
    requestUrlHost = parsed.hostname;
    requestUrlPath = parsed.pathname;
  } catch {
    // If apiBaseUrl is invalid, omit host/path from diagnostics
  }
  return {
    providerKind: PROVIDER_KIND,
    model: config.model,
    providerErrorType,
    ...(requestUrlHost !== undefined ? { requestUrlHost } : {}),
    ...(requestUrlPath !== undefined ? { requestUrlPath } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...safeDetails,
  };
}

// JSON parsing helpers — self-contained to avoid coupling to openai-compatible internals.

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

function findBalancedJsonObjectEnd(text: string, startIndex: number): number | null {
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
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
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
    buildGeminiDiagnostics(config, "provider_json_parse_failed", undefined, {
      contentLength: content.length,
      parseStrategy: "none",
      ...(firstNonWhitespaceChar ? { firstNonWhitespaceChar } : {}),
    }),
  );
}

function extractResponseText(
  data: GeminiGenerateContentResponse,
  config: ProviderRuntimeConfig,
): string {
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || !text.trim()) {
    throw new AiProviderError(buildGeminiDiagnostics(config, "provider_empty_content"));
  }
  return text.trim();
}

async function postGenerateContent(
  config: ProviderRuntimeConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  if (validateAiApiBaseUrl(config.apiBaseUrl)) {
    throw new AiProviderError();
  }

  const url = buildGeminiGenerateUrl(config.apiBaseUrl, config.model);
  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA,
      temperature: config.temperature,
      maxOutputTokens: config.maxTokens,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await response.json()) as GeminiGenerateContentResponse;

    if (!response.ok) {
      throw new AiProviderError(
        buildGeminiDiagnostics(config, "provider_http_error", response.status),
      );
    }

    const text = extractResponseText(data, config);

    if (text.length > AI_PROVIDER_MAX_RESPONSE_CHARS) {
      throw new AiProviderError(
        buildGeminiDiagnostics(config, "provider_response_too_large", undefined, {
          contentLength: text.length,
        }),
      );
    }

    return text;
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }
    throw new AiProviderError(buildGeminiDiagnostics(config, "provider_request_failed"));
  } finally {
    clearTimeout(timeout);
  }
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
  const systemPrompt = buildSystemPrompt(settings.aiAnalysisLanguage);

  const startMs = Date.now();

  try {
    const text = await postGenerateContent(config, systemPrompt, userPrompt);
    return parseJsonContent(text, config);
  } catch (error) {
    const durationMs = Date.now() - startMs;
    if (error instanceof AiProviderError && error.diagnostics) {
      throw new AiProviderError(
        { ...error.diagnostics, contextLength, promptLength, durationMs, usedFallback: false },
        error.message,
      );
    }
    throw error instanceof AiProviderError ? error : new AiProviderError(undefined);
  }
}

export const googleGeminiCustomerInsightProvider: CustomerInsightAIProvider = {
  kind: PROVIDER_KIND,

  async analyzeCustomerInsight(context, settings, config) {
    if (!config) {
      throw new AiProviderError();
    }
    return requestStructuredJson(config, settings, context);
  },
};
