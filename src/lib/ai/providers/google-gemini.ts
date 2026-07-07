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

/** HTTP statuses that may succeed on a subsequent attempt (transient gateway / overload). */
const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);

/** Initial attempt + up to 2 retries. */
export const GEMINI_TRANSIENT_HTTP_MAX_ATTEMPTS = 3;

/** Backoff after attempt 1 and 2 failures (ms). */
export const GEMINI_TRANSIENT_HTTP_RETRY_BACKOFF_MS = [500, 1500] as const;

let retrySleepMs: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** @internal Unit tests inject zero-delay sleep to avoid real backoff waits. */
export function setGeminiRetrySleepMsForTests(fn: (ms: number) => Promise<void>): void {
  retrySleepMs = fn;
}

/** @internal Resets sleep hook after unit tests. */
export function resetGeminiRetrySleepMsForTests(): void {
  retrySleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(status);
}

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
  safeDetails?: Partial<AiProviderDiagnostics>,
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

/** Safe response-structure metadata extracted from a Gemini candidate. */
type GeminiResponseInfo = {
  candidateCount: number;
  partsCount: number;
  textPartsCount: number;
  firstTextPartLength: number;
  combinedTextLength: number;
  finishReason?: string;
};

function extractResponseText(
  data: GeminiGenerateContentResponse,
  config: ProviderRuntimeConfig,
): { combinedText: string; responseInfo: GeminiResponseInfo } {
  const candidate = data.candidates?.[0];
  const candidateCount = data.candidates?.length ?? 0;
  const parts = candidate?.content?.parts ?? [];
  const partsCount = parts.length;
  const finishReason = candidate?.finishReason;

  const textParts = parts.filter((p): p is { text: string } => typeof p.text === "string");
  const textPartsCount = textParts.length;
  const firstTextPartLength = textParts[0]?.text.length ?? 0;

  const combined = textParts.map((p) => p.text).join("");
  const trimmed = combined.trim();
  const combinedTextLength = trimmed.length;

  const responseInfo: GeminiResponseInfo = {
    candidateCount,
    partsCount,
    textPartsCount,
    firstTextPartLength,
    combinedTextLength,
    ...(finishReason !== undefined ? { finishReason } : {}),
  };

  if (!trimmed) {
    throw new AiProviderError(
      buildGeminiDiagnostics(config, "provider_empty_content", undefined, responseInfo),
    );
  }

  return { combinedText: trimmed, responseInfo };
}

async function postGenerateContent(
  config: ProviderRuntimeConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; responseInfo: GeminiResponseInfo }> {
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

  const requestBody = JSON.stringify(body);
  const requestHeaders = {
    "x-goog-api-key": config.apiKey,
    "Content-Type": "application/json",
  };

  for (let attempt = 0; attempt < GEMINI_TRANSIENT_HTTP_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
      });

      const data = (await response.json()) as GeminiGenerateContentResponse;

      if (!response.ok) {
        if (
          isRetryableHttpStatus(response.status) &&
          attempt < GEMINI_TRANSIENT_HTTP_MAX_ATTEMPTS - 1
        ) {
          await retrySleepMs(GEMINI_TRANSIENT_HTTP_RETRY_BACKOFF_MS[attempt]!);
          continue;
        }

        throw new AiProviderError(
          buildGeminiDiagnostics(config, "provider_http_error", response.status),
        );
      }

      const { combinedText, responseInfo } = extractResponseText(data, config);

      if (combinedText.length > AI_PROVIDER_MAX_RESPONSE_CHARS) {
        throw new AiProviderError(
          buildGeminiDiagnostics(config, "provider_response_too_large", undefined, {
            contentLength: combinedText.length,
            ...responseInfo,
          }),
        );
      }

      return { text: combinedText, responseInfo };
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }
      throw new AiProviderError(buildGeminiDiagnostics(config, "provider_request_failed"));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new AiProviderError(buildGeminiDiagnostics(config, "provider_request_failed"));
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
  let responseInfo: GeminiResponseInfo | undefined;

  try {
    const result = await postGenerateContent(config, systemPrompt, userPrompt);
    responseInfo = result.responseInfo;
    return parseJsonContent(result.text, config);
  } catch (error) {
    const durationMs = Date.now() - startMs;
    if (error instanceof AiProviderError && error.diagnostics) {
      throw new AiProviderError(
        {
          ...error.diagnostics,
          ...(responseInfo !== undefined ? responseInfo : {}),
          contextLength,
          promptLength,
          durationMs,
          usedFallback: false,
        },
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
