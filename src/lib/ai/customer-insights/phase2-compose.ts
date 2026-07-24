import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { computeContactAvailability } from "@/lib/ai/customer-insights/context-builder";
import { sanitizeCustomerInsightContextForProvider } from "@/lib/ai/customer-insights/context-sanitize";
import { assessChurnRisk } from "@/lib/ai/phase2/churn";
import {
  filterValidSignalsEvidence,
  maskValidatedEvidence,
  validateEvidenceList,
} from "@/lib/ai/phase2/evidence";
import {
  buildAllowedContextBlob,
  validatePhase2FactSafety,
} from "@/lib/ai/phase2/fact-safety";
import { buildFollowUpRecommendation } from "@/lib/ai/phase2/follow-up-recommendation";
import { safeParsePhase2Insight } from "@/lib/ai/phase2/schema";
import { scoreOpportunity } from "@/lib/ai/phase2/scoring";
import { validateSuggestedEmployeeMessage } from "@/lib/ai/phase2/suggested-message";
import { PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER } from "@/lib/ai/customer-insights/safe-suggested-message";
import type {
  EvidenceReference,
  MissingInformationItem,
  PainPointAssessment,
  Phase2Context,
  Phase2ExtractedSignals,
  Phase2Insight,
  Phase2HeatSummary,
} from "@/lib/ai/phase2/types";
import { PHASE2_LIMITS, PHASE2_VERSION } from "@/lib/ai/phase2/types";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { calculateCustomerHeat } from "@/lib/customers/scoring/heat";
import { getDaysWithoutValidFollowUp } from "@/lib/reclamation/days";

export {
  PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER,
  isPhase2SafeSuggestedMessagePlaceholder,
  isSafeSuggestedMessageAvailable,
} from "@/lib/ai/customer-insights/safe-suggested-message";

export function sanitizeSuggestedEmployeeMessageForPersist(
  message: string,
): string {
  const messageCheck = validateSuggestedEmployeeMessage(message);
  return messageCheck.ok
    ? messageCheck.message
    : PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER;
}

export type Phase2FailureCode =
  | "missing_signals"
  | "invalid_signal_schema"
  | "forbidden_score_injection"
  | "invalid_evidence"
  | "fact_safety_rejected"
  | "local_composition_failed";

export type Phase2CompositionResult =
  | {
      ok: true;
      phase2: Phase2Insight;
      suggestedEmployeeMessage: string;
    }
  | {
      ok: false;
      code: Phase2FailureCode;
      suggestedEmployeeMessage: string;
    };

function buildHeatSummary(
  customer: Customer,
  settings: EffectiveSettings | null,
  now: Date,
): Phase2HeatSummary {
  const nowIso = now.toISOString();
  const nextFollowUpOverdue = !!(
    customer.nextFollowUpAt && customer.nextFollowUpAt < nowIso
  );
  if (!settings) {
    return {
      heatLevel: null,
      daysWithoutValidFollowUp: getDaysWithoutValidFollowUp(customer, now),
      nextFollowUpOverdue,
      reclaimWarningLikely: false,
    };
  }
  const heat = calculateCustomerHeat(customer, settings, now);
  const daysWithoutValidFollowUp = getDaysWithoutValidFollowUp(customer, now);
  const reclaimWarningLikely =
    daysWithoutValidFollowUp >= settings.reclaimWarningThresholdDays ||
    daysWithoutValidFollowUp >= Math.max(1, settings.automaticReclaimDays - 1);
  return {
    heatLevel: heat.heatLevel,
    daysWithoutValidFollowUp,
    nextFollowUpOverdue,
    reclaimWarningLikely,
  };
}

/**
 * Maps insight runtime context into Phase 2 domain context.
 * Does not mutate input. Does not query D1.
 */
export function mapInsightContextToPhase2Context(
  context: CustomerInsightContext,
  options?: {
    customer?: Customer;
    settings?: EffectiveSettings | null;
    now?: Date;
  },
): Phase2Context {
  const now = options?.now ?? new Date();
  const contact = computeContactAvailability(
    context.phone,
    context.email,
    context.wechatId,
  );
  const heat = options?.customer
    ? buildHeatSummary(options.customer, options.settings ?? null, now)
    : {
        heatLevel: null,
        daysWithoutValidFollowUp: null,
        nextFollowUpOverdue: !!(
          context.nextFollowUpAt && context.nextFollowUpAt < now.toISOString()
        ),
        reclaimWarningLikely: false,
      };

  return {
    customerId: context.customerId,
    salesStage: context.salesStage,
    requestedProjectName: context.requestedProjectName,
    customerIntent: null,
    initialNote: context.notes,
    source: context.source,
    createdAt: options?.customer?.createdAt ?? null,
    lastFollowUpAt: context.lastFollowUpAt,
    lastValidFollowUpAt: context.lastValidFollowUpAt,
    nextFollowUpAt: context.nextFollowUpAt,
    contactAvailability: contact,
    heat,
    recentFollowUps: context.recentFollowUps
      .slice(0, PHASE2_LIMITS.followUpContextMax)
      .map((row) => ({
        id: row.id,
        followUpTime: row.followUpTime,
        channel: row.channel,
        outcome: row.outcome,
        summary: row.summary,
        nextAction: row.nextAction,
        nextFollowUpAt: row.nextFollowUpAt,
        customerIntent: row.customerIntent,
        isValidFollowUp: row.isValidFollowUp === 1,
      })),
    stageHistory: [],
  };
}

function collectSignalTexts(signals: Phase2ExtractedSignals): string[] {
  const parts: string[] = [];
  for (const key of [
    "needClarity",
    "customerInitiative",
    "timelineReadiness",
    "documentReadiness",
    "recommendedTopic",
  ] as const) {
    const signal = signals[key];
    if (signal) parts.push(signal.summary);
  }
  for (const concern of signals.concerns) {
    parts.push(concern.summary);
  }
  for (const risk of signals.customerBehaviorRisk) {
    parts.push(risk.summary);
  }
  return parts;
}

function validateAllSignalEvidence(
  signals: Phase2ExtractedSignals,
  phase2Context: Phase2Context,
): Phase2ExtractedSignals | null {
  const needClarity = signals.needClarity
    ? filterValidSignalsEvidence(signals.needClarity, phase2Context)
    : null;
  const customerInitiative = signals.customerInitiative
    ? filterValidSignalsEvidence(signals.customerInitiative, phase2Context)
    : null;
  const timelineReadiness = signals.timelineReadiness
    ? filterValidSignalsEvidence(signals.timelineReadiness, phase2Context)
    : null;
  const documentReadiness = signals.documentReadiness
    ? filterValidSignalsEvidence(signals.documentReadiness, phase2Context)
    : null;
  const recommendedTopic = signals.recommendedTopic
    ? filterValidSignalsEvidence(signals.recommendedTopic, phase2Context)
    : null;

  const concerns = [];
  for (const concern of signals.concerns) {
    const validated = filterValidSignalsEvidence(concern, phase2Context);
    if (validated) concerns.push(validated);
  }

  const customerBehaviorRisk = [];
  for (const risk of signals.customerBehaviorRisk) {
    const validated = filterValidSignalsEvidence(risk, phase2Context);
    if (validated) customerBehaviorRisk.push(validated);
  }

  // If provider sent evidence-backed signals but every evidence failed, treat as invalid.
  const hadAnyEvidence =
    [
      signals.needClarity,
      signals.customerInitiative,
      signals.timelineReadiness,
      signals.documentReadiness,
      signals.recommendedTopic,
      ...signals.concerns,
      ...signals.customerBehaviorRisk,
    ].filter(Boolean).length > 0;

  const keptAny =
    [
      needClarity,
      customerInitiative,
      timelineReadiness,
      documentReadiness,
      recommendedTopic,
      ...concerns,
      ...customerBehaviorRisk,
    ].filter(Boolean).length > 0;

  if (hadAnyEvidence && !keptAny) {
    return null;
  }

  return {
    needClarity,
    customerInitiative,
    timelineReadiness,
    documentReadiness,
    concerns: concerns.slice(0, PHASE2_LIMITS.painPointsMax),
    customerBehaviorRisk: customerBehaviorRisk.slice(
      0,
      PHASE2_LIMITS.riskSignalsMax,
    ),
    recommendedTopic,
  };
}

function buildPainPoints(
  signals: Phase2ExtractedSignals,
): PainPointAssessment[] {
  return signals.concerns.slice(0, PHASE2_LIMITS.painPointsMax).map((concern) => ({
    code: concern.code,
    labelKey: `phase2.painPoint.${concern.code}`,
    severity: concern.level,
    confidence: concern.confidence,
    summary: concern.summary,
    evidence: concern.evidence
      .slice(0, PHASE2_LIMITS.evidencePerPainPointMax)
      .map((item) => maskValidatedEvidence(item)),
    recommendedResponse: null,
  }));
}

function buildMissingInformation(
  baseMissing: string[],
  opportunityStatus: Phase2Insight["opportunity"]["status"],
): MissingInformationItem[] {
  const items: MissingInformationItem[] = baseMissing
    .slice(0, 20)
    .map((summary, index) => ({
      code: `BASE_MISSING_${index + 1}`,
      summary: summary.slice(0, PHASE2_LIMITS.summaryMaxChars) || "missing",
    }));
  if (opportunityStatus === "insufficient_data") {
    items.push({
      code: "OPPORTUNITY_APPLICABLE_WEIGHT",
      summary:
        "Applicable opportunity category weight is below the minimum threshold",
    });
  }
  return items.slice(0, 20);
}

function maskFactorEvidence<T extends { evidence: EvidenceReference[] }>(
  item: T,
): T {
  return {
    ...item,
    evidence: item.evidence.map((e) => maskValidatedEvidence(e)),
  };
}

/**
 * Composes Final Phase2Insight from validated provider signals + local rules.
 * On any Phase 2 failure, returns ok=false with a non-sensitive code.
 */
export function composePhase2Insight(input: {
  insightContext: CustomerInsightContext;
  signals: Phase2ExtractedSignals | null;
  signalsStatus:
    | "missing"
    | "valid"
    | "invalid_schema"
    | "forbidden_score_injection";
  baseMissingInformation: string[];
  suggestedEmployeeMessage: string;
  customer?: Customer;
  settings?: EffectiveSettings | null;
  now?: Date;
}): Phase2CompositionResult {
  const suggestedEmployeeMessage = sanitizeSuggestedEmployeeMessageForPersist(
    input.suggestedEmployeeMessage,
  );

  if (input.signalsStatus === "missing" || input.signals == null) {
    return {
      ok: false,
      code: "missing_signals",
      suggestedEmployeeMessage,
    };
  }
  if (input.signalsStatus === "invalid_schema") {
    return {
      ok: false,
      code: "invalid_signal_schema",
      suggestedEmployeeMessage,
    };
  }
  if (input.signalsStatus === "forbidden_score_injection") {
    return {
      ok: false,
      code: "forbidden_score_injection",
      suggestedEmployeeMessage,
    };
  }

  const phase2Context = mapInsightContextToPhase2Context(input.insightContext, {
    customer: input.customer,
    settings: input.settings,
    now: input.now,
  });

  const sanitizedForFacts = sanitizeCustomerInsightContextForProvider(
    input.insightContext,
  );
  const allowedBlob = buildAllowedContextBlob([
    sanitizedForFacts.notes,
    sanitizedForFacts.sourceRemark,
    sanitizedForFacts.requestedProjectName,
    ...sanitizedForFacts.recentFollowUps.flatMap((f) => [
      f.summary,
      f.nextAction,
      f.customerIntent,
    ]),
  ]);

  for (const text of collectSignalTexts(input.signals)) {
    const safety = validatePhase2FactSafety(allowedBlob, text);
    if (!safety.ok) {
      return {
        ok: false,
        code: "fact_safety_rejected",
        suggestedEmployeeMessage,
      };
    }
  }

  const validatedSignals = validateAllSignalEvidence(
    input.signals,
    phase2Context,
  );
  if (!validatedSignals) {
    return {
      ok: false,
      code: "invalid_evidence",
      suggestedEmployeeMessage,
    };
  }

  try {
    const opportunity = scoreOpportunity({
      context: phase2Context,
      signals: validatedSignals,
      now: input.now,
    });

    // Mask opportunity factor evidence after local scoring used raw validated excerpts.
    const maskedOpportunity = {
      ...opportunity,
      breakdown: opportunity.breakdown.map((row) => ({
        ...row,
        basis: row.basis.map((e) => maskValidatedEvidence(e)),
      })),
      positiveFactors: opportunity.positiveFactors.map(maskFactorEvidence),
      negativeFactors: opportunity.negativeFactors.map(maskFactorEvidence),
    };

    const painPoints = buildPainPoints(validatedSignals);
    const churnRisk = assessChurnRisk({
      context: phase2Context,
      signals: validatedSignals,
    });
    const churnMasked = {
      ...churnRisk,
      customerBehaviorRisk: churnRisk.customerBehaviorRisk.map(maskFactorEvidence),
      crmProcessRisk: churnRisk.crmProcessRisk.map(maskFactorEvidence),
      evidence: churnRisk.evidence.map((e) => maskValidatedEvidence(e)),
    };

    const followUpRecommendation = buildFollowUpRecommendation({
      context: phase2Context,
      signals: validatedSignals,
    });
    const basisValidated = validateEvidenceList(
      followUpRecommendation.basis,
      phase2Context,
    );
    const followUpMasked = {
      ...followUpRecommendation,
      basis: basisValidated.ok
        ? basisValidated.evidence.map((e) => maskValidatedEvidence(e))
        : [],
    };

    const draft: Phase2Insight = {
      version: PHASE2_VERSION,
      opportunity: maskedOpportunity,
      painPoints,
      churnRisk: churnMasked,
      followUpRecommendation: followUpMasked,
      missingInformation: buildMissingInformation(
        input.baseMissingInformation,
        maskedOpportunity.status,
      ),
    };

    const parsed = safeParsePhase2Insight(draft);
    if (!parsed.success) {
      return {
        ok: false,
        code: "local_composition_failed",
        suggestedEmployeeMessage,
      };
    }

    return {
      ok: true,
      phase2: parsed.data,
      suggestedEmployeeMessage,
    };
  } catch {
    return {
      ok: false,
      code: "local_composition_failed",
      suggestedEmployeeMessage,
    };
  }
}

export function serializePhase2Insight(phase2: Phase2Insight): string {
  return JSON.stringify(phase2);
}

export function parseStoredPhase2Json(
  value: string | null | undefined,
): Phase2Insight | null {
  if (value == null || value.trim() === "") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    const result = safeParsePhase2Insight(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
