import { z } from "zod";

const safePlainText = (value: string) =>
  !/<[^>]+>/.test(value) && !/```/.test(value);

export const knowledgeAiQaOutputSchema = z
  .object({
    answer: z.string().trim().min(1).max(8_000).refine(safePlainText),
    citationIds: z
      .array(z.string().trim().min(1).max(120).refine(safePlainText))
      .max(8),
    insufficientInformation: z.boolean(),
  })
  .strict();

export type KnowledgeAiQaOutput = z.infer<typeof knowledgeAiQaOutputSchema>;

export const KNOWLEDGE_AI_QA_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "citationIds", "insufficientInformation"],
  properties: {
    answer: { type: "string" },
    citationIds: { type: "array", items: { type: "string" } },
    insufficientInformation: { type: "boolean" },
  },
} as const;

export function parseKnowledgeAiQaOutput(value: unknown) {
  return knowledgeAiQaOutputSchema.safeParse(value);
}
