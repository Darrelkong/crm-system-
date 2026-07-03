/**
 * Static JSON Schema for Gemini structured-output requests.
 *
 * Mirrors customerInsightOutputSchema (Zod) as a plain JSON Schema object
 * compatible with the Gemini OpenAI-compatible endpoint's json_schema
 * response_format. When this schema is included in a chat completions
 * request, Gemini applies constrained decoding to guarantee a
 * syntactically-valid JSON output that matches the schema structure.
 *
 * Constraints kept deliberately simple:
 * - No $ref / recursive schemas — not supported by Gemini's compat layer
 * - Nullable field uses type array ["string", "null"] — Gemini native format
 * - No additionalProperties — Gemini constrained decode handles this implicitly
 *
 * Must remain in sync with customerInsightOutputSchema in schema.ts.
 */
export const CUSTOMER_INSIGHT_JSON_SCHEMA = {
  type: "object",
  properties: {
    intentLevel: {
      type: "string",
      enum: ["high", "medium", "low", "unknown"],
    },
    intentScore: {
      type: "integer",
      minimum: 0,
      maximum: 100,
    },
    customerSummary: { type: "string" },
    currentSituation: { type: "string" },
    keySignals: {
      type: "array",
      items: { type: "string" },
    },
    riskFlags: {
      type: "array",
      items: { type: "string" },
    },
    missingInformation: {
      type: "array",
      items: { type: "string" },
    },
    nextBestAction: { type: "string" },
    suggestedFollowUpAt: {
      type: ["string", "null"],
    },
    suggestedEmployeeMessage: { type: "string" },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    reasoning: { type: "string" },
  },
  required: [
    "intentLevel",
    "intentScore",
    "customerSummary",
    "currentSituation",
    "keySignals",
    "riskFlags",
    "missingInformation",
    "nextBestAction",
    "suggestedFollowUpAt",
    "suggestedEmployeeMessage",
    "confidence",
    "reasoning",
  ],
} as const;
