import { buildGeminiGenerateUrl } from "@/lib/ai/providers/google-gemini";
import { buildChatCompletionsUrl } from "@/lib/ai/providers/openai-compatible";
import { validateAiApiBaseUrl } from "@/lib/settings/ai-validation";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import type { AiProviderKind } from "@/lib/settings/ai-keys";
import {
  ADMIN_BRIEF_JSON_SCHEMA,
  STAFF_TODAY_ACTIONS_JSON_SCHEMA,
} from "./schemas";
import {
  buildDashboardAiSystemPrompt,
  buildDashboardAiUserPrompt,
  serializeDashboardAiContext,
} from "./prompt";
import type { DashboardAiInsightType } from "./types";
import {
  DASHBOARD_AI_PROVIDER_MAX_RESPONSE_CHARS,
  DASHBOARD_AI_TRANSIENT_BACKOFF_MS,
  DASHBOARD_AI_TRANSIENT_HTTP_STATUSES,
  DASHBOARD_AI_TRANSIENT_MAX_ATTEMPTS,
} from "./constants";

export type DashboardAiProviderConfig = {
  providerKind: AiProviderKind | "mock";
  apiBaseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  apiKey?: string;
};

export type DashboardAiProviderCallResult =
  | { ok: true; raw: unknown }
  | {
      ok: false;
      category:
        | "timeout"
        | "unavailable"
        | "invalid_response"
        | "rate_limited";
    };

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonResponse(content: string): unknown | null {
  try {
    return JSON.parse(stripCodeFence(content)) as unknown;
  } catch {
    return null;
  }
}

function mapHttpCategory(status: number): DashboardAiProviderCallResult {
  if (status === 429) {
    return { ok: false, category: "rate_limited" };
  }
  if (DASHBOARD_AI_TRANSIENT_HTTP_STATUSES.has(status)) {
    return { ok: false, category: "unavailable" };
  }
  return { ok: false, category: "invalid_response" };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAiCompatible(
  config: DashboardAiProviderConfig,
  settings: EffectiveAiSettings,
  insightType: DashboardAiInsightType,
  context: unknown,
): Promise<DashboardAiProviderCallResult> {
  if (!config.apiKey || validateAiApiBaseUrl(config.apiBaseUrl)) {
    return { ok: false, category: "unavailable" };
  }

  const schema =
    insightType === "admin_management_brief"
      ? ADMIN_BRIEF_JSON_SCHEMA
      : STAFF_TODAY_ACTIONS_JSON_SCHEMA;
  const contextJson = serializeDashboardAiContext(context);

  for (let attempt = 0; attempt < DASHBOARD_AI_TRANSIENT_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(
        buildChatCompletionsUrl(config.apiBaseUrl),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            temperature: Math.min(config.temperature, 0.3),
            max_tokens: Math.min(config.maxTokens, 1200),
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "dashboard_ai_insight",
                strict: true,
                schema,
              },
            },
            messages: [
              {
                role: "system",
                content: buildDashboardAiSystemPrompt(
                  insightType,
                  settings.aiAnalysisLanguage,
                ),
              },
              {
                role: "user",
                content: buildDashboardAiUserPrompt(contextJson),
              },
            ],
          }),
        },
        config.timeoutMs,
      );

      if (!response.ok) {
        const mapped = mapHttpCategory(response.status);
        if (
          mapped.ok === false &&
          mapped.category === "unavailable" &&
          attempt < DASHBOARD_AI_TRANSIENT_MAX_ATTEMPTS - 1
        ) {
          await sleep(DASHBOARD_AI_TRANSIENT_BACKOFF_MS[attempt] ?? 400);
          continue;
        }
        return mapped;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content || content.length > DASHBOARD_AI_PROVIDER_MAX_RESPONSE_CHARS) {
        return { ok: false, category: "invalid_response" };
      }
      const raw = parseJsonResponse(content);
      if (!raw) return { ok: false, category: "invalid_response" };
      return { ok: true, raw };
    } catch {
      if (attempt < DASHBOARD_AI_TRANSIENT_MAX_ATTEMPTS - 1) {
        await sleep(DASHBOARD_AI_TRANSIENT_BACKOFF_MS[attempt] ?? 400);
        continue;
      }
      return { ok: false, category: "timeout" };
    }
  }

  return { ok: false, category: "unavailable" };
}

async function callGemini(
  config: DashboardAiProviderConfig,
  settings: EffectiveAiSettings,
  insightType: DashboardAiInsightType,
  context: unknown,
): Promise<DashboardAiProviderCallResult> {
  if (!config.apiKey || validateAiApiBaseUrl(config.apiBaseUrl)) {
    return { ok: false, category: "unavailable" };
  }

  const schema =
    insightType === "admin_management_brief"
      ? ADMIN_BRIEF_JSON_SCHEMA
      : STAFF_TODAY_ACTIONS_JSON_SCHEMA;
  const contextJson = serializeDashboardAiContext(context);

  for (let attempt = 0; attempt < DASHBOARD_AI_TRANSIENT_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(
        buildGeminiGenerateUrl(config.apiBaseUrl, config.model),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": config.apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `${buildDashboardAiSystemPrompt(insightType, settings.aiAnalysisLanguage)}\n\n${buildDashboardAiUserPrompt(contextJson)}`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: Math.min(config.temperature, 0.3),
              maxOutputTokens: Math.min(config.maxTokens, 1200),
              responseMimeType: "application/json",
              responseSchema: schema,
            },
          }),
        },
        config.timeoutMs,
      );

      if (!response.ok) {
        const mapped = mapHttpCategory(response.status);
        if (
          mapped.ok === false &&
          mapped.category === "unavailable" &&
          attempt < DASHBOARD_AI_TRANSIENT_MAX_ATTEMPTS - 1
        ) {
          await sleep(DASHBOARD_AI_TRANSIENT_BACKOFF_MS[attempt] ?? 400);
          continue;
        }
        return mapped;
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!content || content.length > DASHBOARD_AI_PROVIDER_MAX_RESPONSE_CHARS) {
        return { ok: false, category: "invalid_response" };
      }
      const raw = parseJsonResponse(content);
      if (!raw) return { ok: false, category: "invalid_response" };
      return { ok: true, raw };
    } catch {
      if (attempt < DASHBOARD_AI_TRANSIENT_MAX_ATTEMPTS - 1) {
        await sleep(DASHBOARD_AI_TRANSIENT_BACKOFF_MS[attempt] ?? 400);
        continue;
      }
      return { ok: false, category: "timeout" };
    }
  }

  return { ok: false, category: "unavailable" };
}

export async function callDashboardAiProvider(
  config: DashboardAiProviderConfig,
  settings: EffectiveAiSettings,
  insightType: DashboardAiInsightType,
  context: unknown,
): Promise<DashboardAiProviderCallResult> {
  if (config.providerKind === "google_gemini") {
    return callGemini(config, settings, insightType, context);
  }
  if (config.providerKind === "openai_compatible") {
    return callOpenAiCompatible(config, settings, insightType, context);
  }
  return { ok: false, category: "unavailable" };
}

export function resolveDashboardAiProviderConfig(
  settings: EffectiveAiSettings,
  apiKey?: string,
): DashboardAiProviderConfig {
  const useMock = !settings.aiEnabled || settings.aiProvider === "mock";
  return {
    providerKind: useMock ? "mock" : settings.aiProvider,
    apiBaseUrl: settings.aiApiBaseUrl,
    model: settings.aiModel,
    temperature: settings.aiTemperature,
    maxTokens: settings.aiMaxTokens,
    timeoutMs: settings.aiTimeoutMs,
    apiKey,
  };
}
