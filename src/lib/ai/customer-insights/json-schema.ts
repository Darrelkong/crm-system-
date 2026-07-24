/**
 * Static JSON Schema for the Gemini OpenAI-compatible endpoint's json_schema
 * response_format.
 *
 * Constraints kept deliberately simple:
 * - No $ref / recursive schemas
 * - Nullable field uses type array ["string", "null"] — JSON Schema standard
 * - additionalProperties: false
 *
 * Must remain in sync with customerInsightOutputSchema + optional phase2Signals.
 */
import { PHASE2_EXTRACTED_SIGNALS_JSON_SCHEMA } from "@/lib/ai/phase2/provider-json-schema";

const BASE_PROPERTIES = {
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
} as const;

const BASE_REQUIRED = [
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
] as const;

export const CUSTOMER_INSIGHT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...BASE_PROPERTIES,
    phase2Signals: {
      anyOf: [PHASE2_EXTRACTED_SIGNALS_JSON_SCHEMA, { type: "null" }],
    },
  },
  required: [...BASE_REQUIRED],
} as const;

/**
 * Native Gemini responseSchema for generateContent (responseMimeType JSON).
 *
 * Production diagnostics (2026-07-24T16:56Z): Gemini returned INVALID_ARGUMENT
 * with schemaKeywordHint=enum,maximum,minimum after Phase 2 nested signals were
 * added. schemaPathHint was empty, so a field-precise nested fix was not possible.
 *
 * Temporary compatibility: Gemini native schema is Base 12 fields only (the
 * pre-Phase-5C contract that previously succeeded). Phase 2 remains available on
 * OpenAI-compatible json_schema; Gemini refreshes degrade to phase2=null.
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
  required: [...BASE_REQUIRED],
} as const;
