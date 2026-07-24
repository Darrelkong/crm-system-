/**
 * Provider JSON Schema drafts for Phase 2 extracted signals.
 * Does NOT allow a final opportunity score — local scorer owns that.
 *
 * - PHASE2_EXTRACTED_SIGNALS_JSON_SCHEMA: OpenAI-compatible json_schema
 *   (supports anyOf / type unions).
 * - PHASE2_EXTRACTED_SIGNALS_NATIVE_RESPONSE_SCHEMA: Gemini generateContent
 *   responseSchema (OpenAPI 3.0 subset — no anyOf / type arrays /
 *   additionalProperties).
 */

const CONCERN_CODES = [
  "COST_CONCERN",
  "SECURITY_CONCERN",
  "REMOTE_PROCESS_CONCERN",
  "TIMELINE_CONCERN",
  "DOCUMENT_PREPARATION_DIFFICULTY",
  "FAMILY_ALIGNMENT_CONCERN",
  "TRUST_CONCERN",
  "REVIEW_RESULT_MISUNDERSTANDING",
  "PROCESS_UNCERTAINTY",
  "OTHER_EVIDENCE_BACKED_CONCERN",
] as const;

const evidenceItem = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceType: {
      type: "string",
      enum: ["initial_note", "follow_up", "customer_field", "system_rule"],
    },
    sourceId: { type: ["string", "null"] },
    occurredAt: { type: ["string", "null"] },
    excerpt: { type: "string", maxLength: 160 },
    field: { type: ["string", "null"] },
  },
  required: ["sourceType", "sourceId", "occurredAt", "excerpt", "field"],
} as const;

const signal = {
  type: "object",
  additionalProperties: false,
  properties: {
    level: { type: "string", enum: ["low", "medium", "high"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string", maxLength: 400 },
    evidence: {
      type: "array",
      maxItems: 3,
      minItems: 1,
      items: evidenceItem,
    },
  },
  required: ["level", "confidence", "summary", "evidence"],
} as const;

export const PHASE2_EXTRACTED_SIGNALS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    needClarity: { anyOf: [signal, { type: "null" }] },
    customerInitiative: { anyOf: [signal, { type: "null" }] },
    timelineReadiness: { anyOf: [signal, { type: "null" }] },
    documentReadiness: { anyOf: [signal, { type: "null" }] },
    concerns: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...signal.properties,
          code: {
            type: "string",
            enum: [...CONCERN_CODES],
          },
        },
        required: ["level", "confidence", "summary", "evidence", "code"],
      },
    },
    customerBehaviorRisk: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...signal.properties,
          code: { type: "string" },
          kind: {
            type: "string",
            enum: ["customer_behavior", "crm_process"],
          },
        },
        required: [
          "level",
          "confidence",
          "summary",
          "evidence",
          "code",
          "kind",
        ],
      },
    },
    recommendedTopic: { anyOf: [signal, { type: "null" }] },
  },
  required: [
    "needClarity",
    "customerInitiative",
    "timelineReadiness",
    "documentReadiness",
    "concerns",
    "customerBehaviorRisk",
    "recommendedTopic",
  ],
} as const;

/** Alias clarifying this is the Provider Signals schema, not Final Insight. */
export const phase2ExtractedSignalsJsonSchema =
  PHASE2_EXTRACTED_SIGNALS_JSON_SCHEMA;

/**
 * Gemini native responseSchema for Phase 2 signals.
 * Mirrors PHASE2_EXTRACTED_SIGNALS_JSON_SCHEMA without keywords Gemini rejects.
 */
const nativeEvidenceItem = {
  type: "object",
  properties: {
    sourceType: {
      type: "string",
      enum: ["initial_note", "follow_up", "customer_field", "system_rule"],
    },
    sourceId: { type: "string", nullable: true },
    occurredAt: { type: "string", nullable: true },
    excerpt: { type: "string", maxLength: 160 },
    field: { type: "string", nullable: true },
  },
  required: ["sourceType", "sourceId", "occurredAt", "excerpt", "field"],
} as const;

const nativeSignalProperties = {
  level: { type: "string", enum: ["low", "medium", "high"] },
  confidence: { type: "string", enum: ["low", "medium", "high"] },
  summary: { type: "string", maxLength: 400 },
  evidence: {
    type: "array",
    maxItems: 3,
    minItems: 1,
    items: nativeEvidenceItem,
  },
} as const;

const nativeNullableSignal = {
  type: "object",
  nullable: true,
  properties: nativeSignalProperties,
  required: ["level", "confidence", "summary", "evidence"],
} as const;

export const PHASE2_EXTRACTED_SIGNALS_NATIVE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    needClarity: nativeNullableSignal,
    customerInitiative: nativeNullableSignal,
    timelineReadiness: nativeNullableSignal,
    documentReadiness: nativeNullableSignal,
    concerns: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          ...nativeSignalProperties,
          code: {
            type: "string",
            enum: [...CONCERN_CODES],
          },
        },
        required: ["level", "confidence", "summary", "evidence", "code"],
      },
    },
    customerBehaviorRisk: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          ...nativeSignalProperties,
          code: { type: "string" },
          kind: {
            type: "string",
            enum: ["customer_behavior", "crm_process"],
          },
        },
        required: [
          "level",
          "confidence",
          "summary",
          "evidence",
          "code",
          "kind",
        ],
      },
    },
    recommendedTopic: nativeNullableSignal,
  },
  required: [
    "needClarity",
    "customerInitiative",
    "timelineReadiness",
    "documentReadiness",
    "concerns",
    "customerBehaviorRisk",
    "recommendedTopic",
  ],
} as const;

/** Keywords Gemini generateContent responseSchema does not accept. */
const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "anyOf",
  "oneOf",
  "allOf",
  "$ref",
  "additionalProperties",
]);

/**
 * Recursively finds Gemini-unsupported schema constructs.
 * Returns paths like "properties.phase2Signals.anyOf".
 */
export function findGeminiUnsupportedSchemaPaths(
  value: unknown,
  path = "",
): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findGeminiUnsupportedSchemaPaths(item, `${path}[${index}]`),
    );
  }

  const record = value as Record<string, unknown>;
  const found: string[] = [];

  if ("type" in record && Array.isArray(record.type)) {
    found.push(path ? `${path}.type` : "type");
  }

  for (const [key, child] of Object.entries(record)) {
    const childPath = path ? `${path}.${key}` : key;
    if (GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      found.push(childPath);
    }
    found.push(...findGeminiUnsupportedSchemaPaths(child, childPath));
  }

  return found;
}

/** Explicitly documents fields providers must NOT return. */
export const PHASE2_PROVIDER_FORBIDDEN_FIELDS = [
  "opportunity.score",
  "opportunity.breakdown[].score",
  "opportunity.breakdown[].weightedScore",
  "finalScore",
  "intentScore",
] as const;
