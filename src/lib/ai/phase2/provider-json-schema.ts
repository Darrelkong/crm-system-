/**
 * Provider JSON Schema draft for Phase 2 extracted signals.
 * Does NOT allow a final opportunity score — local scorer owns that.
 * Not wired into production providers in Phase 5B.
 */

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
            enum: [
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
            ],
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

/** Explicitly documents fields providers must NOT return. */
export const PHASE2_PROVIDER_FORBIDDEN_FIELDS = [
  "opportunity.score",
  "opportunity.breakdown[].score",
  "opportunity.breakdown[].weightedScore",
  "finalScore",
  "intentScore",
] as const;
