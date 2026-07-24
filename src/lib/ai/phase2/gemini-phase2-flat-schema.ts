/**
 * Candidate Gemini native responseSchema with flat Phase 2 rows (5C-G1).
 * NOT used by Production google-gemini runtime (still Base-12-only).
 */
import { CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA } from "@/lib/ai/customer-insights/json-schema";
import {
  GEMINI_PHASE2_FLAT_ROOT_FIELD,
  GEMINI_PHASE2_FLAT_ROW_FIELDS,
} from "@/lib/ai/phase2/gemini-phase2-flat-contract";

const FLAT_ROW_PROPERTIES = {
  kind: { type: "string" },
  code: { type: "string" },
  level: { type: "string" },
  summary: { type: "string" },
  evidenceSourceType: { type: "string" },
  evidenceSourceId: { type: "string" },
  evidenceField: { type: "string" },
  evidenceExcerpt: { type: "string" },
} as const;

const FLAT_ROW_SCHEMA = {
  type: "object",
  properties: FLAT_ROW_PROPERTIES,
  required: [...GEMINI_PHASE2_FLAT_ROW_FIELDS],
} as const;

/**
 * Candidate Combined Gemini Flat Schema:
 * Base 12 fields + required `phase2SignalRows` (empty array when none).
 */
export const CUSTOMER_INSIGHT_GEMINI_FLAT_CANDIDATE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    ...CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA.properties,
    [GEMINI_PHASE2_FLAT_ROOT_FIELD]: {
      type: "array",
      items: FLAT_ROW_SCHEMA,
    },
  },
  required: [
    ...CUSTOMER_INSIGHT_NATIVE_RESPONSE_SCHEMA.required,
    GEMINI_PHASE2_FLAT_ROOT_FIELD,
  ],
} as const;

export const GEMINI_PHASE2_FLAT_ROW_NATIVE_SCHEMA = FLAT_ROW_SCHEMA;
