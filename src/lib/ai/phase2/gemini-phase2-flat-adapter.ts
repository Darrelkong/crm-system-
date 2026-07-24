/**
 * Adapter: Gemini Flat rows → Phase2ExtractedSignals (5C-G1).
 * Does not run DB evidence validation, Fact Safety, or compose.
 */
import {
  GEMINI_PHASE2_FLAT_BEHAVIOUR_RISK_CODES,
  GEMINI_PHASE2_FLAT_FORBIDDEN_BEHAVIOUR_RISK_CODES,
  GEMINI_PHASE2_FLAT_FORBIDDEN_KINDS,
  GEMINI_PHASE2_FLAT_KINDS,
  GEMINI_PHASE2_FLAT_LEVELS,
  GEMINI_PHASE2_FLAT_OPPORTUNITY_CODES,
  GEMINI_PHASE2_FLAT_OPPORTUNITY_SIGNAL_FIELD_CODES,
  GEMINI_PHASE2_FLAT_PROVIDER_EVIDENCE_SOURCE_TYPES,
  GEMINI_PHASE2_FLAT_RECOMMENDATION_CODE,
  type GeminiPhase2FlatKind,
  type GeminiPhase2FlatOpportunityCode,
} from "@/lib/ai/phase2/gemini-phase2-flat-contract";
import type { GeminiPhase2FlatRow } from "@/lib/ai/phase2/gemini-phase2-flat-parser";
import type {
  EvidenceBackedConcern,
  EvidenceBackedRisk,
  EvidenceBackedSignal,
  EvidenceReference,
  EvidenceSourceType,
  PainPointCode,
  Phase2ExtractedSignals,
} from "@/lib/ai/phase2/types";
import { PAIN_POINT_CODES, PHASE2_LIMITS } from "@/lib/ai/phase2/types";

export type GeminiPhase2FlatRowRejectReason =
  | "unknown_kind"
  | "forbidden_kind"
  | "unknown_code"
  | "forbidden_behaviour_code"
  | "local_only_opportunity_code"
  | "invalid_level"
  | "empty_summary"
  | "missing_evidence"
  | "invalid_evidence_source"
  | "system_rule_rejected"
  | "duplicate"
  /** Singleton opportunity field (needClarity, etc.) already filled. */
  | "opportunity_slot_taken"
  /** recommendedTopic singleton already filled. */
  | "recommendation_slot_taken"
  /** concerns[] reached PHASE2_LIMITS.painPointsMax. */
  | "concern_limit_reached"
  /** customerBehaviorRisk[] reached PHASE2_LIMITS.riskSignalsMax. */
  | "behaviour_risk_limit_reached";

export type GeminiPhase2FlatAdapterStats = {
  accepted: number;
  rejected: number;
  ignored: number;
  rejectReasons: Partial<Record<GeminiPhase2FlatRowRejectReason, number>>;
};

export type GeminiPhase2FlatAdapterResult =
  | {
      status: "ok";
      signals: Phase2ExtractedSignals;
      stats: GeminiPhase2FlatAdapterStats;
    }
  | {
      status: "unavailable";
      reason: "empty_rows" | "zero_valid_rows";
      signals: null;
      stats: GeminiPhase2FlatAdapterStats;
    };

const OPPORTUNITY_FIELD_BY_CODE: Record<
  (typeof GEMINI_PHASE2_FLAT_OPPORTUNITY_SIGNAL_FIELD_CODES)[number],
  keyof Pick<
    Phase2ExtractedSignals,
    | "needClarity"
    | "customerInitiative"
    | "timelineReadiness"
    | "documentReadiness"
  >
> = {
  need_clarity: "needClarity",
  customer_initiative: "customerInitiative",
  timeline_readiness: "timelineReadiness",
  document_readiness: "documentReadiness",
};

const PAIN_POINT_SET = new Set<string>(PAIN_POINT_CODES);
const KIND_SET = new Set<string>(GEMINI_PHASE2_FLAT_KINDS);
const FORBIDDEN_KIND_SET = new Set<string>(GEMINI_PHASE2_FLAT_FORBIDDEN_KINDS);
const OPPORTUNITY_CODE_SET = new Set<string>(GEMINI_PHASE2_FLAT_OPPORTUNITY_CODES);
const OPPORTUNITY_SIGNAL_CODE_SET = new Set<string>(
  GEMINI_PHASE2_FLAT_OPPORTUNITY_SIGNAL_FIELD_CODES,
);
const BEHAVIOUR_RISK_CODE_SET = new Set<string>(
  GEMINI_PHASE2_FLAT_BEHAVIOUR_RISK_CODES,
);
const FORBIDDEN_BEHAVIOUR_CODE_SET = new Set<string>(
  GEMINI_PHASE2_FLAT_FORBIDDEN_BEHAVIOUR_RISK_CODES,
);
const LEVEL_SET = new Set<string>(GEMINI_PHASE2_FLAT_LEVELS);
const PROVIDER_SOURCE_SET = new Set<string>(
  GEMINI_PHASE2_FLAT_PROVIDER_EVIDENCE_SOURCE_TYPES,
);

/** Local default — Flat rows do not carry provider confidence. */
const DEFAULT_CONFIDENCE = "medium" as const;

function emptySignals(): Phase2ExtractedSignals {
  return {
    needClarity: null,
    customerInitiative: null,
    timelineReadiness: null,
    documentReadiness: null,
    concerns: [],
    customerBehaviorRisk: [],
    recommendedTopic: null,
  };
}

function emptyStats(): GeminiPhase2FlatAdapterStats {
  return {
    accepted: 0,
    rejected: 0,
    ignored: 0,
    rejectReasons: {},
  };
}

function bump(
  stats: GeminiPhase2FlatAdapterStats,
  bucket: "accepted" | "rejected" | "ignored",
  reason?: GeminiPhase2FlatRowRejectReason,
): void {
  stats[bucket] += 1;
  if (reason) {
    stats.rejectReasons[reason] = (stats.rejectReasons[reason] ?? 0) + 1;
  }
}

function normalizeExcerptForDedupe(excerpt: string): string {
  return excerpt.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeKey(row: GeminiPhase2FlatRow): string {
  return [
    row.kind,
    row.code,
    row.evidenceSourceType,
    row.evidenceSourceId,
    normalizeExcerptForDedupe(row.evidenceExcerpt),
  ].join("|");
}

function buildEvidence(row: GeminiPhase2FlatRow): EvidenceReference | null {
  if (
    !row.evidenceSourceType ||
    !row.evidenceSourceId ||
    !row.evidenceExcerpt
  ) {
    return null;
  }
  if (row.evidenceSourceType === "system_rule") {
    return null;
  }
  if (!PROVIDER_SOURCE_SET.has(row.evidenceSourceType)) {
    return null;
  }
  return {
    sourceType: row.evidenceSourceType as EvidenceSourceType,
    sourceId: row.evidenceSourceId,
    occurredAt: null,
    excerpt: row.evidenceExcerpt,
    field: row.evidenceField.length > 0 ? row.evidenceField : null,
  };
}

function mapLevel(
  level: string,
): "low" | "medium" | "high" | null {
  if (!LEVEL_SET.has(level)) {
    return null;
  }
  return level as "low" | "medium" | "high";
}

function toSignal(
  row: GeminiPhase2FlatRow,
  evidence: EvidenceReference,
  level: "low" | "medium" | "high",
): EvidenceBackedSignal {
  return {
    level,
    confidence: DEFAULT_CONFIDENCE,
    summary: row.summary,
    evidence: [evidence],
  };
}

export function adaptGeminiPhase2FlatRowsToExtractedSignals(
  rows: GeminiPhase2FlatRow[],
): GeminiPhase2FlatAdapterResult {
  const stats = emptyStats();

  if (rows.length === 0) {
    return {
      status: "unavailable",
      reason: "empty_rows",
      signals: null,
      stats,
    };
  }

  const signals = emptySignals();
  const seen = new Set<string>();

  for (const row of rows) {
    const key = dedupeKey(row);
    if (seen.has(key)) {
      bump(stats, "ignored", "duplicate");
      continue;
    }

    if (FORBIDDEN_KIND_SET.has(row.kind)) {
      bump(stats, "ignored", "forbidden_kind");
      continue;
    }

    if (!KIND_SET.has(row.kind)) {
      bump(stats, "ignored", "unknown_kind");
      continue;
    }

    const kind = row.kind as GeminiPhase2FlatKind;

    if (row.evidenceSourceType === "system_rule") {
      bump(stats, "rejected", "system_rule_rejected");
      continue;
    }

    const evidence = buildEvidence(row);
    if (!evidence) {
      if (!PROVIDER_SOURCE_SET.has(row.evidenceSourceType) && row.evidenceSourceType) {
        bump(stats, "rejected", "invalid_evidence_source");
      } else {
        bump(stats, "rejected", "missing_evidence");
      }
      continue;
    }

    if (kind === "recommendation_topic") {
      if (row.code !== GEMINI_PHASE2_FLAT_RECOMMENDATION_CODE) {
        bump(stats, "ignored", "unknown_code");
        continue;
      }
      if (!row.summary) {
        bump(stats, "rejected", "empty_summary");
        continue;
      }
      // Spec: level empty for recommendation; local default medium.
      if (row.level !== "" && !LEVEL_SET.has(row.level)) {
        bump(stats, "rejected", "invalid_level");
        continue;
      }
      if (signals.recommendedTopic !== null) {
        bump(stats, "ignored", "recommendation_slot_taken");
        continue;
      }
      seen.add(key);
      signals.recommendedTopic = toSignal(row, evidence, "medium");
      bump(stats, "accepted");
      continue;
    }

    if (!row.summary) {
      bump(stats, "rejected", "empty_summary");
      continue;
    }

    const level = mapLevel(row.level);
    if (!level) {
      bump(stats, "rejected", "invalid_level");
      continue;
    }

    if (kind === "opportunity_signal") {
      if (!OPPORTUNITY_CODE_SET.has(row.code)) {
        bump(stats, "ignored", "unknown_code");
        continue;
      }
      if (!OPPORTUNITY_SIGNAL_CODE_SET.has(row.code)) {
        // Local-only opportunity categories — ignore, do not fail.
        bump(stats, "ignored", "local_only_opportunity_code");
        continue;
      }
      const field =
        OPPORTUNITY_FIELD_BY_CODE[
          row.code as (typeof GEMINI_PHASE2_FLAT_OPPORTUNITY_SIGNAL_FIELD_CODES)[number]
        ];
      if (signals[field] !== null) {
        bump(stats, "ignored", "opportunity_slot_taken");
        continue;
      }
      seen.add(key);
      signals[field] = toSignal(row, evidence, level);
      bump(stats, "accepted");
      continue;
    }

    if (kind === "concern") {
      if (!PAIN_POINT_SET.has(row.code)) {
        bump(stats, "ignored", "unknown_code");
        continue;
      }
      if (signals.concerns.length >= PHASE2_LIMITS.painPointsMax) {
        bump(stats, "ignored", "concern_limit_reached");
        continue;
      }
      seen.add(key);
      const concern: EvidenceBackedConcern = {
        ...toSignal(row, evidence, level),
        code: row.code as PainPointCode,
      };
      signals.concerns.push(concern);
      bump(stats, "accepted");
      continue;
    }

    if (kind === "customer_behavior_risk") {
      if (FORBIDDEN_BEHAVIOUR_CODE_SET.has(row.code)) {
        bump(stats, "ignored", "forbidden_behaviour_code");
        continue;
      }
      if (!BEHAVIOUR_RISK_CODE_SET.has(row.code)) {
        // Exact whitelist match only — no case folding / aliasing.
        bump(stats, "ignored", "unknown_code");
        continue;
      }
      if (signals.customerBehaviorRisk.length >= PHASE2_LIMITS.riskSignalsMax) {
        bump(stats, "ignored", "behaviour_risk_limit_reached");
        continue;
      }
      seen.add(key);
      const risk: EvidenceBackedRisk = {
        ...toSignal(row, evidence, level),
        code: row.code,
        kind: "customer_behavior",
      };
      signals.customerBehaviorRisk.push(risk);
      bump(stats, "accepted");
      continue;
    }
  }

  if (stats.accepted === 0) {
    return {
      status: "unavailable",
      reason: "zero_valid_rows",
      signals: null,
      stats,
    };
  }

  return { status: "ok", signals, stats };
}

/** @internal Exported for tests — opportunity code typing. */
export type _GeminiFlatOpportunityCode = GeminiPhase2FlatOpportunityCode;
