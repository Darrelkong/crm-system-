/**
 * Safe normalizers for AI Effect Stats — allowlists only, unknown buckets for legacy gaps.
 */

import type { Phase2FailureCode } from "@/lib/ai/customer-insights/phase2-compose";
import type { AiProviderErrorType } from "@/lib/ai/customer-insights/diagnostics";
import {
  AI_INSIGHT_FEEDBACK_BASE_DEEP_NEGATIVE_TAGS,
  AI_INSIGHT_FEEDBACK_BASE_DEEP_POSITIVE_TAGS,
  AI_INSIGHT_FEEDBACK_PHASE2_NEGATIVE_TAGS,
  AI_INSIGHT_FEEDBACK_PHASE2_POSITIVE_TAGS,
  AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_NEGATIVE_TAGS,
  AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_POSITIVE_TAGS,
} from "@/lib/ai/customer-insights/feedback-contract";
import { AI_INSIGHT_FEEDBACK_REASON_TAGS } from "../../../../drizzle/schema/ai-insight-feedback";

/** Only failureStage literal currently emitted by runtime. */
export const AI_EFFECT_FAILURE_STAGE_ALLOWLIST = ["provider_http"] as const;
export type AiEffectFailureStage =
  (typeof AI_EFFECT_FAILURE_STAGE_ALLOWLIST)[number];

export type AiEffectFailureCategory = "provider" | "non_provider" | "unknown";

const PROVIDER_ERROR_TYPES = new Set<string>([
  "provider_http_error",
  "provider_empty_content",
  "provider_json_parse_failed",
  "provider_response_too_large",
  "schema_validation_failed",
  "provider_request_failed",
] satisfies AiProviderErrorType[]);

/** Non-provider refresh failure codes that may appear without provider diagnostics. */
const NON_PROVIDER_ERROR_CODES = new Set<string>([
  "AI_NOT_CONFIGURED",
  "AI_CONFIG_ERROR",
  "AI_DEEP_ANALYSIS_GLOBAL_DISABLED",
  "AI_DEEP_ANALYSIS_MOCK_ONLY",
  "AI_STAFF_DEEP_ANALYSIS_DISABLED",
  "AI_STAFF_DAILY_LIMIT_REACHED",
  "AI_STAFF_RESERVATION_CONFLICT",
  "AI_REFRESH_DENIED",
]);

export const AI_EFFECT_PHASE2_DEGRADATION_REASON_ALLOWLIST = [
  "missing_signals",
  "invalid_signal_schema",
  "forbidden_score_injection",
  "invalid_evidence",
  "fact_safety_rejected",
  "local_composition_failed",
] as const satisfies readonly Phase2FailureCode[];

export type AiEffectPhase2DegradationReason =
  (typeof AI_EFFECT_PHASE2_DEGRADATION_REASON_ALLOWLIST)[number];

export type AiEffectPhase2Outcome =
  | "generated"
  | "safe_degraded"
  | "ineligible"
  | "unknown";

export type AiEffectProviderKind =
  | "google_gemini"
  | "openai_compatible"
  | "mock"
  | "unknown";

export type AiEffectContractMode =
  | "gemini_flat"
  | "rich"
  | "none"
  | "unknown";

export type AiEffectActorRole = "admin" | "staff" | "unknown";

const COMPONENT_TAG_SET = new Set<string>([
  ...AI_INSIGHT_FEEDBACK_BASE_DEEP_POSITIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_BASE_DEEP_NEGATIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_PHASE2_POSITIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_PHASE2_NEGATIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_POSITIVE_TAGS,
  ...AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_NEGATIVE_TAGS,
]);
const LEGACY_TAG_SET = new Set<string>(AI_INSIGHT_FEEDBACK_REASON_TAGS);
export function normalizeProviderKind(value: unknown): AiEffectProviderKind {
  if (value === "google_gemini" || value === "openai_compatible" || value === "mock") {
    return value;
  }
  return "unknown";
}

export function normalizeContractMode(value: unknown): AiEffectContractMode {
  if (
    value === "gemini_flat" ||
    value === "rich" ||
    value === "none" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

export function normalizeActorRole(value: unknown): AiEffectActorRole {
  if (value === "admin" || value === "staff") return value;
  return "unknown";
}

export function sanitizeDimensionString(
  value: unknown,
  maxLen = 100,
): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > maxLen) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

export function resolvePhase2Eligible(
  contractMode: AiEffectContractMode,
  phase2Eligible: unknown,
): boolean | null {
  if (typeof phase2Eligible === "boolean") return phase2Eligible;
  if (contractMode === "gemini_flat" || contractMode === "rich") return true;
  if (contractMode === "none") return false;
  return null;
}

export function normalizePhase2Outcome(input: {
  contractMode: AiEffectContractMode;
  phase2Eligible?: unknown;
  phase2Generated?: unknown;
}): AiEffectPhase2Outcome {
  const eligible = resolvePhase2Eligible(
    input.contractMode,
    input.phase2Eligible,
  );
  if (eligible === null) return "unknown";
  if (eligible === false) return "ineligible";
  if (input.phase2Generated === true) return "generated";
  if (input.phase2Generated === false) return "safe_degraded";
  return "unknown";
}

export function normalizeDegradationReason(
  value: unknown,
): AiEffectPhase2DegradationReason | "unknown" {
  if (
    typeof value === "string" &&
    (AI_EFFECT_PHASE2_DEGRADATION_REASON_ALLOWLIST as readonly string[]).includes(
      value,
    )
  ) {
    return value as AiEffectPhase2DegradationReason;
  }
  return "unknown";
}

export function classifyRefreshFailure(meta: {
  failureStage?: unknown;
  providerErrorType?: unknown;
  httpStatus?: unknown;
  errorCode?: unknown;
}): AiEffectFailureCategory {
  const stage = meta.failureStage;
  if (typeof stage === "string" && stage.length > 0) {
    if (
      (AI_EFFECT_FAILURE_STAGE_ALLOWLIST as readonly string[]).includes(stage)
    ) {
      return "provider";
    }
    return "unknown";
  }

  if (
    typeof meta.providerErrorType === "string" &&
    PROVIDER_ERROR_TYPES.has(meta.providerErrorType)
  ) {
    return "provider";
  }

  if (
    typeof meta.httpStatus === "number" &&
    Number.isFinite(meta.httpStatus)
  ) {
    return "provider";
  }

  if (
    typeof meta.errorCode === "string" &&
    NON_PROVIDER_ERROR_CODES.has(meta.errorCode)
  ) {
    return "non_provider";
  }

  return "unknown";
}

export function isAllowlistedComponentTag(tag: string): boolean {
  return COMPONENT_TAG_SET.has(tag);
}

export function isAllowlistedLegacyTag(tag: string): boolean {
  return LEGACY_TAG_SET.has(tag);
}

export function parseJsonObject(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
