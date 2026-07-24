import type {
  ChurnRiskAssessment,
  ConfidenceLevel,
  EvidenceReference,
  Phase2Context,
  Phase2ExtractedSignals,
  RiskSignal,
} from "@/lib/ai/phase2/types";

function systemEvidence(code: string, excerpt: string): EvidenceReference {
  return {
    sourceType: "system_rule",
    sourceId: code,
    occurredAt: null,
    excerpt,
    field: null,
  };
}

/**
 * Distinguishes customer-behavior risk from CRM process risk.
 * Does not label employee overdue follow-up as "customer churning".
 */
export function assessChurnRisk(input: {
  context: Phase2Context;
  signals?: Phase2ExtractedSignals | null;
}): ChurnRiskAssessment {
  const { context, signals } = input;
  const customerBehaviorRisk: RiskSignal[] = [];
  const crmProcessRisk: RiskSignal[] = [];
  const evidence: EvidenceReference[] = [];

  const noReply = context.recentFollowUps.filter((f) =>
    ["no_reply", "lost_contact", "no_contact"].includes(f.outcome),
  );
  if (noReply.length >= 2) {
    const sample = noReply[0]!;
    const signal: RiskSignal = {
      code: "REPEATED_NO_REPLY",
      summary:
        "Multiple follow-up outcomes indicate no reply or lost contact (customer-side signal)",
      confidence: "medium",
      evidence: [
        {
          sourceType: "follow_up",
          sourceId: sample.id,
          occurredAt: sample.followUpTime,
          excerpt: sample.summary.trim().slice(0, 160) || sample.outcome,
          field: "outcome",
        },
      ],
    };
    customerBehaviorRisk.push(signal);
    evidence.push(...signal.evidence);
  }

  for (const risk of signals?.customerBehaviorRisk ?? []) {
    if (risk.kind !== "customer_behavior") continue;
    if (risk.evidence.length === 0) continue;
    customerBehaviorRisk.push({
      code: risk.code,
      summary: risk.summary,
      confidence: risk.confidence,
      evidence: risk.evidence.slice(0, 3),
    });
    evidence.push(...risk.evidence.slice(0, 1));
  }

  if (context.heat.nextFollowUpOverdue) {
    const signal: RiskSignal = {
      code: "FOLLOW_UP_OVERDUE",
      summary:
        "Scheduled follow-up is overdue — CRM process risk, not proof the customer lost interest",
      confidence: "high",
      evidence: [
        systemEvidence("RULE_FOLLOW_UP_OVERDUE", "next_follow_up_overdue"),
      ],
    };
    crmProcessRisk.push(signal);
    evidence.push(...signal.evidence);
  }

  if (context.heat.reclaimWarningLikely) {
    const signal: RiskSignal = {
      code: "RECLAIM_WARNING",
      summary:
        "Customer is approaching automatic reclaim thresholds — system recovery risk",
      confidence: "high",
      evidence: [
        systemEvidence("RULE_RECLAIM_WARNING", "reclaim_warning_likely"),
      ],
    };
    crmProcessRisk.push(signal);
    evidence.push(...signal.evidence);
  }

  const hasAny =
    customerBehaviorRisk.length > 0 || crmProcessRisk.length > 0;
  if (!hasAny && context.recentFollowUps.length === 0) {
    return {
      level: "insufficient_data",
      confidence: "low",
      customerBehaviorRisk: [],
      crmProcessRisk: [],
      evidence: [],
      summary: "Insufficient follow-up data to assess churn-related risk",
    };
  }

  let level: ChurnRiskAssessment["level"] = "low";
  let confidence: ConfidenceLevel = "low";
  if (
    customerBehaviorRisk.some((r) => r.code === "REPEATED_NO_REPLY") &&
    crmProcessRisk.length > 0
  ) {
    level = "high";
    confidence = "medium";
  } else if (customerBehaviorRisk.length > 0 || crmProcessRisk.length > 0) {
    level = "medium";
    confidence = "medium";
  }

  const summaryParts: string[] = [];
  if (customerBehaviorRisk.length > 0) {
    summaryParts.push("Customer interaction signals present");
  }
  if (crmProcessRisk.length > 0) {
    summaryParts.push(
      "CRM follow-up/process risk present (not equated to customer disinterest)",
    );
  }
  if (summaryParts.length === 0) {
    summaryParts.push("No major churn-related signals detected in context");
  }

  return {
    level,
    confidence,
    customerBehaviorRisk,
    crmProcessRisk,
    evidence: evidence.slice(0, 12),
    summary: summaryParts.join(". "),
  };
}
