import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import { buildProviderDiagnostics } from "@/lib/ai/customer-insights/diagnostics";
import { AI_PROVIDER_MAX_RESPONSE_CHARS } from "@/lib/ai/customer-insights/limits";
import {
  buildFollowUpOrganizeSystemPrompt,
  buildFollowUpOrganizeUserPrompt,
} from "@/lib/ai/follow-up-organize/prompt";
import { FOLLOW_UP_ORGANIZE_JSON_SCHEMA } from "@/lib/ai/follow-up-organize/schema";
import {
  buildChatCompletionsUrl,
} from "@/lib/ai/providers/openai-compatible";
import { buildGeminiGenerateUrl } from "@/lib/ai/providers/google-gemini";
import type { ProviderRuntimeConfig } from "@/lib/ai/providers/types";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import { validateAiApiBaseUrl } from "@/lib/settings/ai-validation";
import type { AiProviderKind } from "@/lib/settings/ai-keys";

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

async function postOpenAiCompatibleJson(
  config: ProviderRuntimeConfig,
  settings: EffectiveAiSettings,
  text: string,
  referenceDateIso: string,
): Promise<unknown> {
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
      body: JSON.stringify({
        model: config.model,
        temperature: Math.min(config.temperature, 0.3),
        max_tokens: Math.min(config.maxTokens, 1200),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "follow_up_organization",
            strict: true,
            schema: FOLLOW_UP_ORGANIZE_JSON_SCHEMA,
          },
        },
        messages: [
          {
            role: "system",
            content: buildFollowUpOrganizeSystemPrompt(settings.aiAnalysisLanguage),
          },
          {
            role: "user",
            content: buildFollowUpOrganizeUserPrompt({
              text,
              referenceDateIso,
              timezone: "Asia/Hong_Kong",
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    if (!response.ok) {
      throw new AiProviderError(
        buildProviderDiagnostics(
          config,
          "openai_compatible",
          "provider_http_error",
          response.status,
        ),
      );
    }
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new AiProviderError(
        buildProviderDiagnostics(
          config,
          "openai_compatible",
          "provider_empty_content",
        ),
      );
    }
    if (content.length > AI_PROVIDER_MAX_RESPONSE_CHARS) {
      throw new AiProviderError(
        buildProviderDiagnostics(
          config,
          "openai_compatible",
          "provider_response_too_large",
        ),
      );
    }
    try {
      return JSON.parse(stripCodeFence(content)) as unknown;
    } catch {
      throw new AiProviderError(
        buildProviderDiagnostics(
          config,
          "openai_compatible",
          "provider_json_parse_failed",
        ),
      );
    }
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(
      buildProviderDiagnostics(
        config,
        "openai_compatible",
        "provider_request_failed",
      ),
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function postGeminiJson(
  config: ProviderRuntimeConfig,
  settings: EffectiveAiSettings,
  text: string,
  referenceDateIso: string,
): Promise<unknown> {
  if (validateAiApiBaseUrl(config.apiBaseUrl)) {
    throw new AiProviderError();
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const url = buildGeminiGenerateUrl(config.apiBaseUrl, config.model);
    const response = await fetch(url, {
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
                text: `${buildFollowUpOrganizeSystemPrompt(settings.aiAnalysisLanguage)}\n\n${buildFollowUpOrganizeUserPrompt({
                  text,
                  referenceDateIso,
                  timezone: "Asia/Hong_Kong",
                })}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: Math.min(config.temperature, 0.3),
          maxOutputTokens: Math.min(config.maxTokens, 1200),
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (!response.ok) {
      throw new AiProviderError(
        buildProviderDiagnostics(
          config,
          "google_gemini",
          "provider_http_error",
          response.status,
        ),
      );
    }
    const content = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!content) {
      throw new AiProviderError(
        buildProviderDiagnostics(
          config,
          "google_gemini",
          "provider_empty_content",
        ),
      );
    }
    if (content.length > AI_PROVIDER_MAX_RESPONSE_CHARS) {
      throw new AiProviderError(
        buildProviderDiagnostics(
          config,
          "google_gemini",
          "provider_response_too_large",
        ),
      );
    }
    try {
      return JSON.parse(stripCodeFence(content)) as unknown;
    } catch {
      throw new AiProviderError(
        buildProviderDiagnostics(
          config,
          "google_gemini",
          "provider_json_parse_failed",
        ),
      );
    }
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(
      buildProviderDiagnostics(
        config,
        "google_gemini",
        "provider_request_failed",
      ),
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function callFollowUpOrganizeProvider(input: {
  kind: AiProviderKind;
  config: ProviderRuntimeConfig;
  settings: EffectiveAiSettings;
  text: string;
  referenceDateIso: string;
}): Promise<unknown> {
  if (input.kind === "openai_compatible") {
    return postOpenAiCompatibleJson(
      input.config,
      input.settings,
      input.text,
      input.referenceDateIso,
    );
  }
  if (input.kind === "google_gemini") {
    return postGeminiJson(
      input.config,
      input.settings,
      input.text,
      input.referenceDateIso,
    );
  }
  throw new AiProviderError();
}
