import { z } from "zod";

export const CUSTOMER_AI_INTENT_LEVELS = ["high", "medium", "low", "unknown"] as const;

export const customerInsightOutputSchema = z.object({
  intentLevel: z.enum(CUSTOMER_AI_INTENT_LEVELS),
  intentScore: z.number().int().min(0).max(100),
  customerSummary: z.string().min(1),
  currentSituation: z.string().min(1),
  keySignals: z.array(z.string()),
  riskFlags: z.array(z.string()),
  missingInformation: z.array(z.string()),
  nextBestAction: z.string().min(1),
  suggestedFollowUpAt: z.string().nullable(),
  suggestedEmployeeMessage: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});

export type CustomerInsightOutput = z.infer<typeof customerInsightOutputSchema>;

export const PROMPT_VERSION = "phase-1a-v1";

export function parseCustomerInsightOutput(data: unknown): CustomerInsightOutput {
  return customerInsightOutputSchema.parse(data);
}
