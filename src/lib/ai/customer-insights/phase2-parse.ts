import {
  safeParseCustomerInsightOutput,
  type CustomerInsightOutput,
} from "@/lib/ai/customer-insights/schema";
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

/**
 * Splits provider JSON into base deep-analysis fields + optional phase2Signals.
 * Unknown top-level keys (other than phase2Signals) fail the whole parse.
 * Invalid / missing phase2Signals do not fail the base result.
 */
export function parseCombinedCustomerInsightProviderOutput(
  raw: unknown,
): CombinedCustomerInsightParseResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, reason: "not_object" };
  }

  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      key !== "phase2Signals" &&
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

  if (!("phase2Signals" in record)) {
    return {
      success: true,
      output: baseParsed.data,
      phase2Signals: null,
      phase2SignalsStatus: "missing",
    };
  }

  const signalsRaw = record.phase2Signals;
  if (signalsRaw == null) {
    return {
      success: true,
      output: baseParsed.data,
      phase2Signals: null,
      phase2SignalsStatus: "missing",
    };
  }

  if (containsForbiddenScoreInjection(signalsRaw)) {
    return {
      success: true,
      output: baseParsed.data,
      phase2Signals: null,
      phase2SignalsStatus: "forbidden_score_injection",
    };
  }

  const signalsParsed = safeParsePhase2ExtractedSignals(signalsRaw);
  if (!signalsParsed.success) {
    return {
      success: true,
      output: baseParsed.data,
      phase2Signals: null,
      phase2SignalsStatus: "invalid_schema",
    };
  }

  return {
    success: true,
    output: baseParsed.data,
    phase2Signals: signalsParsed.data,
    phase2SignalsStatus: "valid",
  };
}
