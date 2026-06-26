import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import type { AiProviderKind } from "@/lib/settings/ai-keys";

export type ProviderRuntimeConfig = {
  apiBaseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  apiKey: string;
};

export interface CustomerInsightAIProvider {
  readonly kind: AiProviderKind;
  analyzeCustomerInsight(
    context: CustomerInsightContext,
    settings: EffectiveAiSettings,
    config?: ProviderRuntimeConfig,
  ): Promise<unknown>;
}

export type ResolvedCustomerInsightProvider = {
  kind: AiProviderKind;
  model: string;
  config: ProviderRuntimeConfig | null;
};
