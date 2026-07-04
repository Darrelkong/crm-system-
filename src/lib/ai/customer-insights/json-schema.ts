/**
 * Static JSON Schema for the Gemini OpenAI-compatible endpoint's json_schema
 * response_format.
 *
 * Constraints kept deliberately simple:
 * - No $ref / recursive schemas
 * - Nullable field uses type array ["string", "null"] — JSON Schema standard
 * - No additionalProperties
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

/**
 * Native Gemini responseSchema for use with the generateContent API
 * (responseMimeType: "application/json").
 *
 * Differs from CUSTOMER_INSIGHT_JSON_SCHEMA in one place only:
 * - suggestedFollowUpAt uses { type: "string", nullable: true } instead of
 *   { type: ["string", "null"] } because the native generateContent API uses
 *   OpenAPI 3.0 semantics, not full JSON Schema.
 *
 * All other fields are identical to CUSTOMER_INSIGHT_JSON_SCHEMA.
 * Must remain in sync with customerInsightOutputSchema in schema.ts.
 */
export const CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA = {
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
      type: "string",
      nullable: true,
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
