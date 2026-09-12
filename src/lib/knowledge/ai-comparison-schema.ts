import { z } from "zod";

const safePlainText = (value: string) =>
  !/<[^>]+>/.test(value) && !/```/.test(value);

const diffItemSchema = z
  .object({
    id: z.string().trim().min(1).max(40).refine(safePlainText),
    topic: z.string().trim().min(1).max(160).refine(safePlainText),
    existingValue: z
      .string()
      .trim()
      .max(1_000)
      .refine(safePlainText)
      .nullable(),
    incomingValue: z
      .string()
      .trim()
      .max(1_000)
      .refine(safePlainText)
      .nullable(),
    explanation: z.string().trim().min(1).max(600).refine(safePlainText),
    confidence: z.number().min(0).max(1),
    sourceExcerpt: z
      .string()
      .trim()
      .max(500)
      .refine(safePlainText)
      .nullable(),
    existingExcerpt: z
      .string()
      .trim()
      .max(500)
      .refine(safePlainText)
      .nullable(),
  })
  .strict();

const suggestedUpdateSchema = z
  .object({
    topic: z.string().trim().min(1).max(160).refine(safePlainText),
    suggestion: z.string().trim().min(1).max(600).refine(safePlainText),
    rationale: z.string().trim().min(1).max(600).refine(safePlainText),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const knowledgeAiComparisonOutputSchema = z
  .object({
    relationship: z.enum(["update_existing", "new_article", "ambiguous"]),
    matchedCandidateKey: z
      .enum(["C1", "C2", "C3"])
      .nullable(),
    matchConfidence: z.number().min(0).max(1),
    newFacts: z.array(diffItemSchema).max(20),
    changedFacts: z.array(diffItemSchema).max(20),
    conflicts: z.array(diffItemSchema).max(20),
    uncertainties: z.array(diffItemSchema).max(20),
    suggestedUpdates: z.array(suggestedUpdateSchema).max(20),
  })
  .strict();

export type KnowledgeAiComparisonOutput = z.infer<
  typeof knowledgeAiComparisonOutputSchema
>;

export type KnowledgeComparisonDiffItem = z.infer<typeof diffItemSchema>;
export type KnowledgeComparisonSuggestedUpdate = z.infer<
  typeof suggestedUpdateSchema
>;

export type KnowledgeComparisonStoredResult = {
  relationship: "update_existing" | "new_article" | "ambiguous" | "no_match";
  matchedCandidateKey: "C1" | "C2" | "C3" | null;
  matchConfidence: number | null;
  newFacts: KnowledgeComparisonDiffItem[];
  changedFacts: KnowledgeComparisonDiffItem[];
  conflicts: KnowledgeComparisonDiffItem[];
  uncertainties: KnowledgeComparisonDiffItem[];
  suggestedUpdates: KnowledgeComparisonSuggestedUpdate[];
  degradationLevel?: string | null;
};

export function emptyNoMatchComparisonResult(): KnowledgeComparisonStoredResult {
  return {
    relationship: "no_match",
    matchedCandidateKey: null,
    matchConfidence: null,
    newFacts: [],
    changedFacts: [],
    conflicts: [],
    uncertainties: [],
    suggestedUpdates: [],
  };
}

export function parseKnowledgeAiComparisonOutput(value: unknown) {
  return knowledgeAiComparisonOutputSchema.safeParse(value);
}

export const KNOWLEDGE_AI_COMPARISON_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "relationship",
    "matchedCandidateKey",
    "matchConfidence",
    "newFacts",
    "changedFacts",
    "conflicts",
    "uncertainties",
    "suggestedUpdates",
  ],
  properties: {
    relationship: {
      type: "string",
      enum: ["update_existing", "new_article", "ambiguous"],
    },
    matchedCandidateKey: {
      type: ["string", "null"],
      enum: ["C1", "C2", "C3", null],
    },
    matchConfidence: { type: "number" },
    newFacts: { type: "array", items: { type: "object" } },
    changedFacts: { type: "array", items: { type: "object" } },
    conflicts: { type: "array", items: { type: "object" } },
    uncertainties: { type: "array", items: { type: "object" } },
    suggestedUpdates: { type: "array", items: { type: "object" } },
  },
} as const;
