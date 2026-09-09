import { z } from "zod";

const safePlainText = (value: string) =>
  !/<[^>]+>/.test(value) && !/```/.test(value);

export const knowledgeAiOrganizationOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).refine(safePlainText),
    summary: z
      .string()
      .trim()
      .max(1_000)
      .refine(safePlainText)
      .nullable(),
    body: z
      .string()
      .trim()
      .min(1)
      .max(100_000)
      .refine(safePlainText),
    suggestedCategory: z
      .string()
      .trim()
      .max(120)
      .refine(safePlainText)
      .nullable(),
    warnings: z
      .array(z.string().trim().min(1).max(300).refine(safePlainText))
      .max(20),
  })
  .strict();

export type KnowledgeAiOrganizationOutput = z.infer<
  typeof knowledgeAiOrganizationOutputSchema
>;

export function parseKnowledgeAiOrganizationOutput(value: unknown) {
  return knowledgeAiOrganizationOutputSchema.safeParse(value);
}

export const KNOWLEDGE_AI_ORGANIZATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "body", "suggestedCategory", "warnings"],
  properties: {
    title: { type: "string" },
    summary: { type: ["string", "null"] },
    body: { type: "string" },
    suggestedCategory: { type: ["string", "null"] },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;
