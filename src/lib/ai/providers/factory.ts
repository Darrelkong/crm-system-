import { getAiApiKeyFromEnv } from "@/lib/ai/env";
import { AiConfigError } from "@/lib/ai/customer-insights/errors";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import { mockCustomerInsightProvider } from "./mock";
import { openAiCompatibleCustomerInsightProvider } from "./openai-compatible";
import { googleGeminiCustomerInsightProvider } from "./google-gemini";
import type {
  CustomerInsightAIProvider,
  ResolvedCustomerInsightProvider,
} from "./types";

const MOCK_MODEL = "mock-customer-insight-v1";

export function resolveCustomerInsightProvider(
  settings: EffectiveAiSettings,
): ResolvedCustomerInsightProvider {
  const useMock =
    !settings.aiEnabled || settings.aiProvider === "mock";

  if (useMock) {
    return {
      kind: "mock",
      model: MOCK_MODEL,
      config: null,
    };
  }

  const apiKey = getAiApiKeyFromEnv();
  if (!settings.aiApiBaseUrlValid) {
    throw new AiConfigError("AI 尚未完成配置", "AI_CONFIG_ERROR");
  }
  if (!apiKey) {
    throw new AiConfigError();
  }

  return {
    kind: settings.aiProvider,
    model: settings.aiModel,
    config: {
      apiBaseUrl: settings.aiApiBaseUrl,
      model: settings.aiModel,
      temperature: settings.aiTemperature,
      maxTokens: settings.aiMaxTokens,
      timeoutMs: settings.aiTimeoutMs,
      apiKey,
    },
  };
}

export function getCustomerInsightProviderImpl(
  resolved: ResolvedCustomerInsightProvider,
): CustomerInsightAIProvider {
  if (resolved.kind === "openai_compatible") return openAiCompatibleCustomerInsightProvider;
  if (resolved.kind === "google_gemini") return googleGeminiCustomerInsightProvider;
  return mockCustomerInsightProvider;
}
