/**
 * Server-side parser for Gemini Flat Phase 2 rows (5C-G1).
 * Strictness lives here — not in Gemini native responseSchema.
 */
import {
  GEMINI_PHASE2_FLAT_PARSER_LIMITS,
  GEMINI_PHASE2_FLAT_ROOT_FIELD,
  GEMINI_PHASE2_FLAT_ROW_FIELDS,
  type GeminiPhase2FlatRowField,
} from "@/lib/ai/phase2/gemini-phase2-flat-contract";

export type GeminiPhase2FlatRow = Record<GeminiPhase2FlatRowField, string>;

export type GeminiPhase2FlatParseFailureCode =
  | "missing_field"
  | "not_array"
  | "oversized_array"
  | "row_not_object"
  | "field_not_string"
  | "field_too_long"
  | "control_characters"
  | "unknown_top_level";

export type GeminiPhase2FlatParseResult =
  | { success: true; rows: GeminiPhase2FlatRow[] }
  | {
      success: false;
      code: GeminiPhase2FlatParseFailureCode;
      field?: string;
    };

const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const FIELD_LIMITS: Record<GeminiPhase2FlatRowField, number> = {
  kind: GEMINI_PHASE2_FLAT_PARSER_LIMITS.kindMax,
  code: GEMINI_PHASE2_FLAT_PARSER_LIMITS.codeMax,
  level: GEMINI_PHASE2_FLAT_PARSER_LIMITS.levelMax,
  summary: GEMINI_PHASE2_FLAT_PARSER_LIMITS.summaryMax,
  evidenceSourceType: GEMINI_PHASE2_FLAT_PARSER_LIMITS.evidenceSourceTypeMax,
  evidenceSourceId: GEMINI_PHASE2_FLAT_PARSER_LIMITS.evidenceSourceIdMax,
  evidenceField: GEMINI_PHASE2_FLAT_PARSER_LIMITS.evidenceFieldMax,
  evidenceExcerpt: GEMINI_PHASE2_FLAT_PARSER_LIMITS.evidenceExcerptMax,
};

const BASE_TOP_LEVEL_KEYS = new Set([
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
  GEMINI_PHASE2_FLAT_ROOT_FIELD,
]);

function hasControlCharacters(value: string): boolean {
  return CONTROL_CHAR_RE.test(value);
}

function parseRow(
  raw: unknown,
  index: number,
):
  | { success: true; row: GeminiPhase2FlatRow }
  | { success: false; code: GeminiPhase2FlatParseFailureCode; field?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, code: "row_not_object", field: `rows[${index}]` };
  }

  const record = raw as Record<string, unknown>;
  const row = {} as GeminiPhase2FlatRow;

  for (const field of GEMINI_PHASE2_FLAT_ROW_FIELDS) {
    const value = record[field];
    if (typeof value !== "string") {
      return {
        success: false,
        code: "field_not_string",
        field: `rows[${index}].${field}`,
      };
    }
    if (hasControlCharacters(value)) {
      return {
        success: false,
        code: "control_characters",
        field: `rows[${index}].${field}`,
      };
    }
    const trimmed = value.trim();
    if (trimmed.length > FIELD_LIMITS[field]) {
      return {
        success: false,
        code: "field_too_long",
        field: `rows[${index}].${field}`,
      };
    }
    // Excerpt: trim ends only — do not alter internal substance.
    row[field] = field === "evidenceExcerpt" ? trimmed : trimmed;
  }

  return { success: true, row };
}

/**
 * Parse `phase2SignalRows` from a combined provider payload or a bare array.
 * Unknown top-level keys (when given a full object) fail the Flat contract parse.
 */
export function parseGeminiPhase2FlatRows(
  input: unknown,
): GeminiPhase2FlatParseResult {
  let rowsRaw: unknown;

  if (Array.isArray(input)) {
    rowsRaw = input;
  } else if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!BASE_TOP_LEVEL_KEYS.has(key)) {
        return { success: false, code: "unknown_top_level", field: key };
      }
    }
    if (!(GEMINI_PHASE2_FLAT_ROOT_FIELD in record)) {
      return {
        success: false,
        code: "missing_field",
        field: GEMINI_PHASE2_FLAT_ROOT_FIELD,
      };
    }
    rowsRaw = record[GEMINI_PHASE2_FLAT_ROOT_FIELD];
  } else {
    return {
      success: false,
      code: "missing_field",
      field: GEMINI_PHASE2_FLAT_ROOT_FIELD,
    };
  }

  if (!Array.isArray(rowsRaw)) {
    return { success: false, code: "not_array" };
  }

  if (rowsRaw.length > GEMINI_PHASE2_FLAT_PARSER_LIMITS.maxRows) {
    return { success: false, code: "oversized_array" };
  }

  const rows: GeminiPhase2FlatRow[] = [];
  for (let i = 0; i < rowsRaw.length; i += 1) {
    const parsed = parseRow(rowsRaw[i], i);
    if (!parsed.success) {
      return {
        success: false,
        code: parsed.code,
        ...(parsed.field !== undefined ? { field: parsed.field } : {}),
      };
    }
    rows.push(parsed.row);
  }

  return { success: true, rows };
}
