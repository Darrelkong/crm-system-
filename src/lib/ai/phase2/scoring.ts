import {
  computeOpportunityConfidence,
  countIndependentEvidenceSources,
  isOnlyInitialNoteEvidence,
} from "@/lib/ai/phase2/confidence";
import {
  MINIMUM_APPLICABLE_WEIGHT,
  OPPORTUNITY_CATEGORY_LABEL_KEYS,
  OPPORTUNITY_CATEGORY_WEIGHTS,
} from "@/lib/ai/phase2/scoring-config";
import type {
  CategoryScoreInput,
  ConfidenceLevel,
  EvidenceBackedFactor,
  EvidenceReference,
  OpportunityAssessment,
  OpportunityCategoryCode,
  OpportunityScoreBreakdown,
  Phase2Context,
  Phase2ExtractedSignals,
  Phase2FollowUpContext,
} from "@/lib/ai/phase2/types";
import { OPPORTUNITY_CATEGORY_CODES } from "@/lib/ai/phase2/types";

const MS_DAY = 24 * 60 * 60 * 1000;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function daysBetween(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / MS_DAY);
}

function hasText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

function systemEvidence(
  ruleCode: string,
  excerpt: string,
): EvidenceReference {
  return {
    sourceType: "system_rule",
    sourceId: ruleCode,
    occurredAt: null,
    excerpt,
    field: null,
  };
}

function scored(
  code: OpportunityCategoryCode,
  score: number,
  confidence: ConfidenceLevel,
  basis: EvidenceReference[],
  explanation: string,
): CategoryScoreInput {
  return {
    code,
    status: "scored",
    score: clampScore(score),
    confidence,
    basis,
    explanation,
  };
}

function insufficient(
  code: OpportunityCategoryCode,
  explanation: string,
): CategoryScoreInput {
  return {
    code,
    status: "insufficient_data",
    score: null,
    confidence: "low",
    basis: [],
    explanation,
  };
}

function notApplicable(
  code: OpportunityCategoryCode,
  explanation: string,
): CategoryScoreInput {
  return {
    code,
    status: "not_applicable",
    score: null,
    confidence: "low",
    basis: [],
    explanation,
  };
}

function scoreNeedClarity(
  context: Phase2Context,
  signals: Phase2ExtractedSignals | null,
): CategoryScoreInput {
  const basis: EvidenceReference[] = [];
  let points = 0;
  if (hasText(context.requestedProjectName)) {
    points += 40;
    basis.push({
      sourceType: "customer_field",
      sourceId: null,
      occurredAt: null,
      excerpt: context.requestedProjectName!.trim().slice(0, 160),
      field: "requested_project_name",
    });
  }
  if (hasText(context.customerIntent)) {
    points += 25;
    basis.push({
      sourceType: "customer_field",
      sourceId: null,
      occurredAt: null,
      excerpt: context.customerIntent!.trim().slice(0, 160),
      field: "customer_intent",
    });
  }
  if (hasText(context.initialNote)) {
    points += 20;
    basis.push({
      sourceType: "initial_note",
      sourceId: "initial_note",
      occurredAt: context.createdAt,
      excerpt: context.initialNote!.trim().slice(0, 160),
      field: null,
    });
  }
  if (signals?.needClarity) {
    const boost =
      signals.needClarity.level === "high"
        ? 15
        : signals.needClarity.level === "medium"
          ? 10
          : 5;
    points += boost;
    basis.push(...signals.needClarity.evidence.slice(0, 2));
  }
  if (basis.length === 0) {
    return insufficient("NEED_CLARITY", "No structured need signals available");
  }
  // Presence of notes alone does not max the category.
  if (
    basis.length === 1 &&
    basis[0]?.sourceType === "initial_note" &&
    !hasText(context.requestedProjectName)
  ) {
    points = Math.min(points, 45);
  }
  return scored(
    "NEED_CLARITY",
    points,
    basis.length >= 2 ? "medium" : "low",
    basis.slice(0, 3),
    "Need clarity from project name, intent, initial note, and optional AI signals",
  );
}

function scoreInteractionActivity(
  context: Phase2Context,
  now: Date,
): CategoryScoreInput {
  const followUps = context.recentFollowUps;
  if (followUps.length === 0) {
    return insufficient(
      "INTERACTION_ACTIVITY",
      "No recent follow-up records in context window",
    );
  }
  const validCount = followUps.filter((f) => f.isValidFollowUp).length;
  const daysSinceLast = daysBetween(context.lastFollowUpAt, now);
  let score = Math.min(40, followUps.length * 8);
  score += Math.min(30, validCount * 10);
  if (daysSinceLast !== null) {
    if (daysSinceLast <= 7) score += 30;
    else if (daysSinceLast <= 14) score += 20;
    else if (daysSinceLast <= 30) score += 10;
  }
  const basis: EvidenceReference[] = [
    systemEvidence(
      "RULE_INTERACTION_COUNT",
      `recent_follow_ups=${followUps.length};valid=${validCount}`,
    ),
  ];
  if (context.lastFollowUpAt) {
    basis.push({
      sourceType: "customer_field",
      sourceId: null,
      occurredAt: context.lastFollowUpAt,
      excerpt: context.lastFollowUpAt,
      field: "last_follow_up_at",
    });
  }
  return scored(
    "INTERACTION_ACTIVITY",
    score,
    "medium",
    basis.slice(0, 3),
    "Interaction activity from follow-up cadence; staff-only volume is not treated as customer replies",
  );
}

const INITIATIVE_OUTCOMES = new Set([
  "replied",
  "interested",
  "considering",
  "contact_made",
]);

function scoreCustomerInitiative(
  context: Phase2Context,
  signals: Phase2ExtractedSignals | null,
): CategoryScoreInput {
  const initiativeRows = context.recentFollowUps.filter((f) =>
    INITIATIVE_OUTCOMES.has(f.outcome),
  );
  const basis: EvidenceReference[] = [];
  let score = 0;
  if (initiativeRows.length > 0) {
    score += Math.min(70, initiativeRows.length * 25);
    const sample = initiativeRows[0]!;
    basis.push({
      sourceType: "follow_up",
      sourceId: sample.id,
      occurredAt: sample.followUpTime,
      excerpt: sample.summary.trim().slice(0, 160) || sample.outcome,
      field: "outcome",
    });
  }
  if (signals?.customerInitiative) {
    score +=
      signals.customerInitiative.level === "high"
        ? 30
        : signals.customerInitiative.level === "medium"
          ? 20
          : 10;
    basis.push(...signals.customerInitiative.evidence.slice(0, 2));
  }
  if (basis.length === 0) {
    return insufficient(
      "CUSTOMER_INITIATIVE",
      "No customer-initiative outcomes or evidence-backed signals",
    );
  }
  return scored(
    "CUSTOMER_INITIATIVE",
    score,
    basis.length >= 2 ? "medium" : "low",
    basis.slice(0, 3),
    "Customer initiative from reply/interest outcomes and optional AI signals",
  );
}

function scoreTimelineReadiness(
  context: Phase2Context,
  signals: Phase2ExtractedSignals | null,
  now: Date,
): CategoryScoreInput {
  const basis: EvidenceReference[] = [];
  let score = 0;
  if (context.nextFollowUpAt) {
    const overdue = context.nextFollowUpAt < now.toISOString();
    score += overdue ? 40 : 70;
    basis.push({
      sourceType: "customer_field",
      sourceId: null,
      occurredAt: context.nextFollowUpAt,
      excerpt: context.nextFollowUpAt,
      field: "next_follow_up_at",
    });
  }
  if (signals?.timelineReadiness) {
    score +=
      signals.timelineReadiness.level === "high"
        ? 30
        : signals.timelineReadiness.level === "medium"
          ? 20
          : 10;
    basis.push(...signals.timelineReadiness.evidence.slice(0, 2));
  }
  if (basis.length === 0) {
    return insufficient(
      "TIMELINE_READINESS",
      "No explicit next_follow_up_at or timeline evidence",
    );
  }
  return scored(
    "TIMELINE_READINESS",
    score,
    "medium",
    basis.slice(0, 3),
    "Timeline readiness from explicit schedule and optional evidence; vague phrasing is ignored",
  );
}

function scoreDocumentReadiness(
  signals: Phase2ExtractedSignals | null,
): CategoryScoreInput {
  if (!signals?.documentReadiness) {
    return notApplicable(
      "DOCUMENT_READINESS",
      "No document-status evidence; category excluded (no penalty)",
    );
  }
  const score =
    signals.documentReadiness.level === "high"
      ? 85
      : signals.documentReadiness.level === "medium"
        ? 60
        : 35;
  return scored(
    "DOCUMENT_READINESS",
    score,
    signals.documentReadiness.confidence,
    signals.documentReadiness.evidence.slice(0, 3),
    "Document readiness from evidence-backed signals only",
  );
}

function scoreNextStepClarity(
  context: Phase2Context,
  now: Date,
): CategoryScoreInput {
  const latest = context.recentFollowUps[0] as
    | Phase2FollowUpContext
    | undefined;
  const basis: EvidenceReference[] = [];
  let score = 0;
  if (latest && hasText(latest.nextAction)) {
    score += 55;
    basis.push({
      sourceType: "follow_up",
      sourceId: latest.id,
      occurredAt: latest.followUpTime,
      excerpt: latest.nextAction!.trim().slice(0, 160),
      field: "next_action",
    });
  }
  if (context.nextFollowUpAt) {
    score += context.nextFollowUpAt >= now.toISOString() ? 35 : 20;
    basis.push({
      sourceType: "customer_field",
      sourceId: null,
      occurredAt: context.nextFollowUpAt,
      excerpt: context.nextFollowUpAt,
      field: "next_follow_up_at",
    });
  }
  if (basis.length === 0) {
    return insufficient(
      "NEXT_STEP_CLARITY",
      "No next_action or next_follow_up_at available",
    );
  }
  return scored(
    "NEXT_STEP_CLARITY",
    score,
    basis.length >= 2 ? "high" : "medium",
    basis.slice(0, 3),
    "Next-step clarity from next_action and scheduled follow-up",
  );
}

function scoreConcernSeverity(
  signals: Phase2ExtractedSignals | null,
): CategoryScoreInput {
  const concerns = signals?.concerns ?? [];
  if (concerns.length === 0) {
    return notApplicable(
      "CONCERN_SEVERITY",
      "No concern evidence; category excluded (no automatic penalty or bonus)",
    );
  }
  // Fewer / milder concerns → higher score.
  let penalty = 0;
  const basis: EvidenceReference[] = [];
  for (const concern of concerns.slice(0, 5)) {
    penalty +=
      concern.level === "high" ? 25 : concern.level === "medium" ? 15 : 8;
    basis.push(...concern.evidence.slice(0, 1));
  }
  const score = clampScore(100 - penalty);
  return scored(
    "CONCERN_SEVERITY",
    score,
    "medium",
    basis.slice(0, 3),
    "Concern severity inverted: fewer evidence-backed blockers score higher",
  );
}

function scoreEngagementRisk(
  context: Phase2Context,
): CategoryScoreInput {
  const noReplyish = context.recentFollowUps.filter((f) =>
    ["no_reply", "no_contact", "lost_contact"].includes(f.outcome),
  );
  const basis: EvidenceReference[] = [];
  let riskPoints = 0;
  if (noReplyish.length > 0) {
    riskPoints += Math.min(50, noReplyish.length * 20);
    const sample = noReplyish[0]!;
    basis.push({
      sourceType: "follow_up",
      sourceId: sample.id,
      occurredAt: sample.followUpTime,
      excerpt: sample.summary.trim().slice(0, 160) || sample.outcome,
      field: "outcome",
    });
  }
  if (context.heat.reclaimWarningLikely || context.heat.nextFollowUpOverdue) {
    riskPoints += 30;
    basis.push(
      systemEvidence(
        "RULE_CRM_PROCESS_RISK",
        context.heat.nextFollowUpOverdue
          ? "next_follow_up_overdue"
          : "reclaim_warning_likely",
      ),
    );
  }
  if (
    context.heat.daysWithoutValidFollowUp !== null &&
    context.heat.daysWithoutValidFollowUp >= 7
  ) {
    riskPoints += Math.min(30, context.heat.daysWithoutValidFollowUp);
  }
  if (basis.length === 0 && riskPoints === 0) {
    return scored(
      "ENGAGEMENT_RISK",
      80,
      "low",
      [systemEvidence("RULE_ENGAGEMENT_STABLE", "no_major_engagement_risk")],
      "No major engagement-risk signals in context",
    );
  }
  // Higher engagement health when risk is lower.
  return scored(
    "ENGAGEMENT_RISK",
    clampScore(100 - riskPoints),
    "medium",
    basis.slice(0, 3),
    "Engagement risk combines customer no-reply outcomes with CRM process risk flags",
  );
}

function scoreRecordReliability(context: Phase2Context): CategoryScoreInput {
  const followUps = context.recentFollowUps;
  if (followUps.length === 0) {
    return insufficient(
      "RECORD_RELIABILITY",
      "No follow-up records to assess reliability",
    );
  }
  let good = 0;
  for (const row of followUps) {
    let points = 0;
    if (hasText(row.summary) && row.summary.trim().length >= 10) points += 1;
    if (hasText(row.nextAction)) points += 1;
    if (hasText(row.outcome)) points += 1;
    if (points >= 2) good += 1;
  }
  const ratio = good / followUps.length;
  const score = clampScore(ratio * 100);
  return scored(
    "RECORD_RELIABILITY",
    score,
    "medium",
    [
      systemEvidence(
        "RULE_RECORD_RELIABILITY",
        `complete_rows=${good}/${followUps.length}`,
      ),
    ],
    "Record reliability from presence of summary, next_action, and outcome — not staff performance ranking",
  );
}

function toBreakdown(input: CategoryScoreInput): OpportunityScoreBreakdown {
  const weight = OPPORTUNITY_CATEGORY_WEIGHTS[input.code];
  const weightedScore =
    input.status === "scored" && input.score !== null
      ? (input.score * weight) / 100
      : null;
  return {
    code: input.code,
    labelKey: OPPORTUNITY_CATEGORY_LABEL_KEYS[input.code],
    weight,
    status: input.status,
    score: input.score,
    weightedScore,
    confidence: input.confidence,
    basis: input.basis,
    explanation: input.explanation,
  };
}

export type ScoreOpportunityInput = {
  context: Phase2Context;
  signals?: Phase2ExtractedSignals | null;
  now?: Date;
  hasMajorConflict?: boolean;
  positiveFactors?: EvidenceBackedFactor[];
  negativeFactors?: EvidenceBackedFactor[];
  recommendedAction?: string | null;
};

/**
 * Applies applicable-weight normalization to a completed breakdown.
 * Exported for exact formula tests (59/60 threshold, weighted averages).
 */
export function finalizeOpportunityFromBreakdown(input: {
  breakdown: OpportunityScoreBreakdown[];
  hasMajorConflict?: boolean;
  positiveFactors?: EvidenceBackedFactor[];
  negativeFactors?: EvidenceBackedFactor[];
  recommendedAction?: string | null;
}): OpportunityAssessment {
  const breakdown = input.breakdown;
  const scoredRows = breakdown.filter((row) => row.status === "scored");
  const applicableWeight = scoredRows.reduce((sum, row) => sum + row.weight, 0);
  const independentEvidenceSourceCount =
    countIndependentEvidenceSources(breakdown);
  const onlyInitialNote = isOnlyInitialNoteEvidence(breakdown);
  const confidence = computeOpportunityConfidence({
    applicableWeight,
    independentEvidenceSourceCount,
    hasMajorConflict: !!input.hasMajorConflict,
    onlyInitialNoteEvidence: onlyInitialNote,
  });

  if (applicableWeight < MINIMUM_APPLICABLE_WEIGHT) {
    return {
      status: "insufficient_data",
      score: null,
      confidence: "low",
      trend: "unavailable",
      breakdown,
      positiveFactors: input.positiveFactors ?? [],
      negativeFactors: input.negativeFactors ?? [],
      recommendedAction: input.recommendedAction ?? null,
    };
  }

  const weightedRaw = scoredRows.reduce(
    (sum, row) => sum + (row.score ?? 0) * row.weight,
    0,
  );
  const finalScore = clampScore(weightedRaw / applicableWeight);

  return {
    status: "available",
    score: finalScore,
    confidence,
    trend: "unavailable",
    breakdown,
    positiveFactors: input.positiveFactors ?? [],
    negativeFactors: input.negativeFactors ?? [],
    recommendedAction: input.recommendedAction ?? null,
  };
}

/**
 * Local deterministic opportunity scorer.
 * Provider signals may influence some categories but never set the final score.
 */
export function scoreOpportunity(
  input: ScoreOpportunityInput,
): OpportunityAssessment {
  const now = input.now ?? new Date();
  const signals = input.signals ?? null;
  const categoryInputs: CategoryScoreInput[] = [
    scoreNeedClarity(input.context, signals),
    scoreInteractionActivity(input.context, now),
    scoreCustomerInitiative(input.context, signals),
    scoreTimelineReadiness(input.context, signals, now),
    scoreDocumentReadiness(signals),
    scoreNextStepClarity(input.context, now),
    scoreConcernSeverity(signals),
    scoreEngagementRisk(input.context),
    scoreRecordReliability(input.context),
  ];

  // Ensure stable order matching config.
  const byCode = new Map(categoryInputs.map((c) => [c.code, c]));
  const breakdown = OPPORTUNITY_CATEGORY_CODES.map((code) =>
    toBreakdown(byCode.get(code)!),
  );

  return finalizeOpportunityFromBreakdown({
    breakdown,
    hasMajorConflict: input.hasMajorConflict,
    positiveFactors: input.positiveFactors,
    negativeFactors: input.negativeFactors,
    recommendedAction: input.recommendedAction,
  });
}

/** Alias with explicit Phase 5C-friendly naming. */
export const calculateOpportunityAssessment = scoreOpportunity;
