import {
  safeParseCustomerInsightOutput,
  type CustomerInsightOutput,
} from "@/lib/ai/customer-insights/schema";
import type { AiProviderPhase2ContractMode } from "@/lib/ai/customer-insights/provider-contract-mode";
import { adaptGeminiPhase2FlatRowsToExtractedSignals } from "@/lib/ai/phase2/gemini-phase2-flat-adapter";
import { GEMINI_PHASE2_FLAT_ROOT_FIELD } from "@/lib/ai/phase2/gemini-phase2-flat-contract";
import { parseGeminiPhase2FlatRows } from "@/lib/ai/phase2/gemini-phase2-flat-parser";
import { safeParsePhase2ExtractedSignals } from "@/lib/ai/phase2/schema";
import type { Phase2ExtractedSignals } from "@/lib/ai/phase2/types";

export const CUSTOMER_INSIGHT_BASE_FIELD_KEYS = [
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

export type CustomerInsightBaseFieldKey =
  (typeof CUSTOMER_INSIGHT_BASE_FIELD_KEYS)[number];

export type Phase2SignalsParseStatus =
  | "missing"
  | "valid"
  | "invalid_schema"
  | "forbidden_score_injection";

export type CombinedCustomerInsightParseResult =
  | {
      success: true;
      output: CustomerInsightOutput;
      phase2Signals: Phase2ExtractedSignals | null;
      phase2SignalsStatus: Phase2SignalsParseStatus;
      phase2ContractMode: AiProviderPhase2ContractMode;
    }
  | {
      success: false;
      reason: "not_object" | "unknown_top_level_field" | "base_invalid";
      field?: string;
    };

const FORBIDDEN_PHASE2_SCORE_KEYS = [
  "opportunity",
  "finalScore",
  "weightedScore",
  "trend",
  "generatedAt",
  "promptVersion",
  "customerId",
  "staffId",
] as const;

const PHASE2_TOP_LEVEL_KEYS = new Set<string>([
  "phase2Signals",
  GEMINI_PHASE2_FLAT_ROOT_FIELD,
]);

function containsForbiddenScoreInjection(value: unknown, depth = 0): boolean {
  if (depth > 6 || value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenScoreInjection(item, depth + 1));
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if ((FORBIDDEN_PHASE2_SCORE_KEYS as readonly string[]).includes(key)) {
      return true;
    }
    if (containsForbiddenScoreInjection(obj[key], depth + 1)) return true;
  }
  return false;
}

function parseRichPhase2Signals(
  signalsRaw: unknown,
): {
  phase2Signals: Phase2ExtractedSignals | null;
  phase2SignalsStatus: Phase2SignalsParseStatus;
} {
  if (signalsRaw == null) {
    return { phase2Signals: null, phase2SignalsStatus: "missing" };
  }
  if (containsForbiddenScoreInjection(signalsRaw)) {
    return {
      phase2Signals: null,
      phase2SignalsStatus: "forbidden_score_injection",
    };
  }
  const signalsParsed = safeParsePhase2ExtractedSignals(signalsRaw);
  if (!signalsParsed.success) {
    return { phase2Signals: null, phase2SignalsStatus: "invalid_schema" };
  }
  return {
    phase2Signals: signalsParsed.data,
    phase2SignalsStatus: "valid",
  };
}

/**
 * Flat Phase 2 path: parse/adapt only; Evidence / Fact Safety / Compose stay in service.
 * Flat failures never fail Base.
 */
function parseFlatPhase2Signals(record: Record<string, unknown>): {
  phase2Signals: Phase2ExtractedSignals | null;
  phase2SignalsStatus: Phase2SignalsParseStatus;
} {
  if (!(GEMINI_PHASE2_FLAT_ROOT_FIELD in record)) {
    return { phase2Signals: null, phase2SignalsStatus: "missing" };
  }

  // Pass only the Flat root (+ ignore Base keys) into the Flat parser so Base
  // fields do not trip Flat unknown-top-level checks.
  const flatPayload = {
    [GEMINI_PHASE2_FLAT_ROOT_FIELD]: record[GEMINI_PHASE2_FLAT_ROOT_FIELD],
  };
  const flatParsed = parseGeminiPhase2FlatRows(flatPayload);
  if (!flatParsed.success) {
    return { phase2Signals: null, phase2SignalsStatus: "invalid_schema" };
  }

  const adapted = adaptGeminiPhase2FlatRowsToExtractedSignals(flatParsed.rows);
  if (adapted.status !== "ok" || adapted.signals == null) {
    // Empty / zero-valid rows → soft missing (Base ready, phase2=null).
    return { phase2Signals: null, phase2SignalsStatus: "missing" };
  }

  if (containsForbiddenScoreInjection(adapted.signals)) {
    return {
      phase2Signals: null,
      phase2SignalsStatus: "forbidden_score_injection",
    };
  }

  // Domain Zod gate before compose (adapter already maps to domain shape).
  const signalsParsed = safeParsePhase2ExtractedSignals(adapted.signals);
  if (!signalsParsed.success) {
    return { phase2Signals: null, phase2SignalsStatus: "invalid_schema" };
  }

  return {
    phase2Signals: signalsParsed.data,
    phase2SignalsStatus: "valid",
  };
}

export type ParseCombinedCustomerInsightOptions = {
  /**
   * Server-selected contract mode. Defaults to auto:
   * prefer Flat rows when present, else rich phase2Signals.
   */
  phase2ContractMode?: AiProviderPhase2ContractMode;
};

/**
 * Splits provider JSON into Base-12 fields + optional Phase 2 signals.
 *
 * Base is always projected then strict-parsed independently of Phase 2.
 * Unknown top-level keys (other than phase2Signals / phase2SignalRows) fail
 * the whole parse. Invalid / missing Phase 2 never fails Base.
 */
export function parseCombinedCustomerInsightProviderOutput(
  raw: unknown,
  options?: ParseCombinedCustomerInsightOptions,
): CombinedCustomerInsightParseResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, reason: "not_object" };
  }

  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      !PHASE2_TOP_LEVEL_KEYS.has(key) &&
      !(CUSTOMER_INSIGHT_BASE_FIELD_KEYS as readonly string[]).includes(key)
    ) {
      return {
        success: false,
        reason: "unknown_top_level_field",
        field: key,
      };
    }
  }

  const basePayload: Record<string, unknown> = {};
  for (const key of CUSTOMER_INSIGHT_BASE_FIELD_KEYS) {
    if (key in record) basePayload[key] = record[key];
  }

  const baseParsed = safeParseCustomerInsightOutput(basePayload);
  if (!baseParsed.success) {
    return { success: false, reason: "base_invalid" };
  }

  const mode: AiProviderPhase2ContractMode =
    options?.phase2ContractMode ??
    (GEMINI_PHASE2_FLAT_ROOT_FIELD in record
      ? "gemini_flat"
      : "phase2Signals" in record
        ? "rich"
        : "none");

  if (mode === "none") {
    return {
      success: true,
      output: baseParsed.data,
      phase2Signals: null,
      phase2SignalsStatus: "missing",
      phase2ContractMode: mode,
    };
  }

  if (mode === "gemini_flat") {
    const flat = parseFlatPhase2Signals(record);
    return {
      success: true,
      output: baseParsed.data,
      phase2Signals: flat.phase2Signals,
      phase2SignalsStatus: flat.phase2SignalsStatus,
      phase2ContractMode: mode,
    };
  }

  // rich
  if (!("phase2Signals" in record)) {
    return {
      success: true,
      output: baseParsed.data,
      phase2Signals: null,
      phase2SignalsStatus: "missing",
      phase2ContractMode: mode,
    };
  }

  const rich = parseRichPhase2Signals(record.phase2Signals);
  return {
    success: true,
    output: baseParsed.data,
    phase2Signals: rich.phase2Signals,
    phase2SignalsStatus: rich.phase2SignalsStatus,
    phase2ContractMode: mode,
  };
}
