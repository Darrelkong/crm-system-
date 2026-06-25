import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import type { CustomerInsightOutput } from "@/lib/ai/customer-insights/schema";

export type AIProviderKind = "mock";

export interface CustomerInsightAIProvider {
  readonly kind: AIProviderKind;
  readonly model: string;
  analyzeCustomerInsight(context: CustomerInsightContext): Promise<CustomerInsightOutput>;
}

export type AnalyzeCustomerInsightRequest = {
  context: CustomerInsightContext;
};

export type AnalyzeCustomerInsightResult = CustomerInsightOutput & {
  model: string;
};
