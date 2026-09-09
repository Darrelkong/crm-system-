import { AiProviderError } from "@/lib/ai/customer-insights/errors";
import { buildProviderDiagnostics } from "@/lib/ai/customer-insights/diagnostics";
import { AI_PROVIDER_MAX_RESPONSE_CHARS } from "@/lib/ai/customer-insights/limits";
import {
  buildChatCompletionsUrl,
} from "@/lib/ai/providers/openai-compatible";
import { buildGeminiGenerateUrl } from "@/lib/ai/providers/google-gemini";
import type { ProviderRuntimeConfig } from "@/lib/ai/providers/types";
import { validateAiApiBaseUrl } from "@/lib/settings/ai-validation";
import { KNOWLEDGE_AI_ORGANIZATION_JSON_SCHEMA } from "@/lib/knowledge/ai-organizer-schema";

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

function stripCodeFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(stripCodeFence(content)) as unknown;
  } catch {
    throw new KnowledgeAiProviderOutputError();
  }
}

async function postOpenAiCompatible(
  config: ProviderRuntimeConfig,
  systemPrompt: string,
  userPrompt: string,
  responseSchema: Readonly<Record<string, unknown>> =
    KNOWLEDGE_AI_ORGANIZATION_JSON_SCHEMA,
  responseSchemaName = "knowledge_source_organization",
): Promise<unknown> {
  if (validateAiApiBaseUrl(config.apiBaseUrl)) throw new AiProviderError();
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
        max_tokens: Math.min(config.maxTokens, 4096),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: responseSchemaName,
            strict: true,
            schema: responseSchema,
          },
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
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
    if (!content) throw new AiProviderError();
    if (content.length > AI_PROVIDER_MAX_RESPONSE_CHARS) {
      throw new AiProviderError();
    }
    return parseJson(content);
  } catch (error) {
    if (error instanceof KnowledgeAiProviderOutputError) throw error;
    if (error instanceof KnowledgeAiProviderTimeoutError) throw error;
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new KnowledgeAiProviderTimeoutError();
    }
    throw new AiProviderError();
  } finally {
    clearTimeout(timeout);
  }
}

async function postGemini(
  config: ProviderRuntimeConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<unknown> {
  if (validateAiApiBaseUrl(config.apiBaseUrl)) throw new AiProviderError();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(
      buildGeminiGenerateUrl(config.apiBaseUrl, config.model),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: Math.min(config.temperature, 0.3),
            maxOutputTokens: Math.min(config.maxTokens, 4096),
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      },
    );
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
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!content) throw new AiProviderError();
    if (content.length > AI_PROVIDER_MAX_RESPONSE_CHARS) {
      throw new AiProviderError();
    }
    return parseJson(content);
  } catch (error) {
    if (error instanceof KnowledgeAiProviderOutputError) throw error;
    if (error instanceof KnowledgeAiProviderTimeoutError) throw error;
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new KnowledgeAiProviderTimeoutError();
    }
    throw new AiProviderError();
  } finally {
    clearTimeout(timeout);
  }
}

export async function callKnowledgeOrganizationProvider(input: {
  kind: "openai_compatible" | "google_gemini";
  config: ProviderRuntimeConfig;
  systemPrompt: string;
  userPrompt: string;
}): Promise<unknown> {
  if (input.kind === "openai_compatible") {
    return postOpenAiCompatible(
      input.config,
      input.systemPrompt,
      input.userPrompt,
    );
  }
  return postGemini(
    input.config,
    input.systemPrompt,
    input.userPrompt,
  );
}

export async function callKnowledgeStructuredProvider(input: {
  kind: "openai_compatible" | "google_gemini";
  config: ProviderRuntimeConfig;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Readonly<Record<string, unknown>>;
  responseSchemaName: string;
}): Promise<unknown> {
  if (input.kind === "openai_compatible") {
    return postOpenAiCompatible(
      input.config,
      input.systemPrompt,
      input.userPrompt,
      input.responseSchema,
      input.responseSchemaName,
    );
  }
  return postGemini(input.config, input.systemPrompt, input.userPrompt);
}
