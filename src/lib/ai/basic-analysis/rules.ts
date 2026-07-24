import type {
  BasicAnalysisFinding,
  BasicAnalysisFindingCode,
  BasicAnalysisInput,
  BasicAnalysisRecommendedAction,
  BasicAnalysisSummaryStatus,
  BasicCustomerAnalysis,
} from "@/lib/ai/basic-analysis/types";
import { BASIC_ANALYSIS_SOURCE } from "@/lib/ai/basic-analysis/types";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const FINDING_PRIORITY: BasicAnalysisFindingCode[] = [
  "FOLLOW_UP_OVERDUE",
  "RECLAMATION_APPROACHING",
  "FOLLOW_UP_NEVER",
  "FOLLOW_UP_DAYS_SINCE",
  "NEXT_ACTION_MISSING",
  "BUSINESS_NEED_MISSING",
  "CONTACT_MISSING",
  "CUSTOMER_NAME_MISSING",
  "NEXT_FOLLOW_UP_MISSING",
  "SALES_STAGE_MISSING",
];

function hasText(value: string | null | undefined): value is string {
  return !!value && value.trim().length > 0;
}

function daysBetween(earlierIso: string, laterIso: string): number {
  return Math.floor(
    (new Date(laterIso).getTime() - new Date(earlierIso).getTime()) /
      MS_PER_DAY,
  );
}

function hoursBetween(earlierIso: string, laterIso: string): number {
  return Math.floor(
    (new Date(laterIso).getTime() - new Date(earlierIso).getTime()) /
      MS_PER_HOUR,
  );
}

function priorityIndex(code: BasicAnalysisFindingCode): number {
  const idx = FINDING_PRIORITY.indexOf(code);
  return idx === -1 ? FINDING_PRIORITY.length : idx;
}

function dedupeFindings(findings: BasicAnalysisFinding[]): BasicAnalysisFinding[] {
  const sorted = [...findings].sort(
    (a, b) => priorityIndex(a.code) - priorityIndex(b.code),
  );
  const seenFamilies = new Set<string>();
  const result: BasicAnalysisFinding[] = [];
  const hasOverdue = sorted.some((f) => f.code === "FOLLOW_UP_OVERDUE");

  for (const finding of sorted) {
    // Overdue next follow-up already covers follow-up lag; skip days-since.
    if (hasOverdue && finding.code === "FOLLOW_UP_DAYS_SINCE") {
      continue;
    }
    const family =
      finding.code === "FOLLOW_UP_NEVER" ||
      finding.code === "FOLLOW_UP_DAYS_SINCE"
        ? "FOLLOW_UP_GAP"
        : finding.code;
    if (seenFamilies.has(family)) continue;
    seenFamilies.add(family);
    result.push(finding);
  }

  return result.sort((a, b) => priorityIndex(a.code) - priorityIndex(b.code));
}

function summaryFromFindings(
  findings: BasicAnalysisFinding[],
): BasicAnalysisSummaryStatus {
  if (findings.some((f) => f.severity === "high")) return "urgent";
  if (findings.some((f) => f.severity === "warning")) return "attention";
  return "normal";
}

/**
 * Deterministic CRM rule analysis. Pure function — does not mutate input,
 * does not call external AI, and does not invent sales intent.
 */
export function buildBasicCustomerAnalysis(
  input: BasicAnalysisInput,
): BasicCustomerAnalysis {
  const findings: BasicAnalysisFinding[] = [];
  const missingData: BasicCustomerAnalysis["missingData"] = [];
  const positiveSignals: BasicCustomerAnalysis["positiveSignals"] = [];

  if (!hasText(input.customerName)) {
    missingData.push({
      field: "customerName",
      labelKey: "customers.basicAnalysis.fields.customerName",
    });
    findings.push({
      code: "CUSTOMER_NAME_MISSING",
      severity: "warning",
      titleKey: "customers.basicAnalysis.findings.customerNameMissing.title",
      descriptionKey:
        "customers.basicAnalysis.findings.customerNameMissing.description",
      evidence: { field: "customerName", value: null },
      recommendedAction: {
        type: "COMPLETE_PROFILE",
        labelKey: "customers.basicAnalysis.actions.completeProfile",
      },
    });
  }

  if (!hasText(input.phone) && !hasText(input.wechatId)) {
    missingData.push({
      field: "phone_or_wechat",
      labelKey: "customers.basicAnalysis.fields.contact",
    });
    findings.push({
      code: "CONTACT_MISSING",
      severity: "high",
      titleKey: "customers.basicAnalysis.findings.contactMissing.title",
      descriptionKey:
        "customers.basicAnalysis.findings.contactMissing.description",
      evidence: { field: "phone_or_wechat", value: null, present: false },
      recommendedAction: {
        type: "COMPLETE_PROFILE",
        labelKey: "customers.basicAnalysis.actions.completeProfile",
      },
    });
  } else {
    positiveSignals.push({
      code: "CONTACT_PRESENT",
      titleKey: "customers.basicAnalysis.positive.contactPresent",
    });
  }

  if (!hasText(input.requestedProjectName)) {
    missingData.push({
      field: "requestedProjectName",
      labelKey: "customers.basicAnalysis.fields.businessNeed",
    });
    findings.push({
      code: "BUSINESS_NEED_MISSING",
      severity: "warning",
      titleKey: "customers.basicAnalysis.findings.businessNeedMissing.title",
      descriptionKey:
        "customers.basicAnalysis.findings.businessNeedMissing.description",
      evidence: { field: "requestedProjectName", value: null },
      recommendedAction: {
        type: "COMPLETE_PROFILE",
        labelKey: "customers.basicAnalysis.actions.completeBusinessNeed",
      },
    });
  } else {
    positiveSignals.push({
      code: "BUSINESS_NEED_PRESENT",
      titleKey: "customers.basicAnalysis.positive.businessNeedPresent",
    });
  }

  if (!hasText(input.salesStage)) {
    missingData.push({
      field: "salesStage",
      labelKey: "customers.basicAnalysis.fields.salesStage",
    });
    findings.push({
      code: "SALES_STAGE_MISSING",
      severity: "info",
      titleKey: "customers.basicAnalysis.findings.salesStageMissing.title",
      descriptionKey:
        "customers.basicAnalysis.findings.salesStageMissing.description",
      evidence: { field: "salesStage", value: null },
      recommendedAction: {
        type: "REVIEW_STAGE",
        labelKey: "customers.basicAnalysis.actions.reviewStage",
      },
    });
  }

  if (!input.hasAnyFollowUp) {
    findings.push({
      code: "FOLLOW_UP_NEVER",
      severity: "high",
      titleKey: "customers.basicAnalysis.findings.followUpNever.title",
      descriptionKey:
        "customers.basicAnalysis.findings.followUpNever.description",
      evidence: { field: "lastFollowUpAt", value: null },
      recommendedAction: {
        type: "ADD_FOLLOW_UP",
        labelKey: "customers.basicAnalysis.actions.addFollowUp",
      },
    });
    missingData.push({
      field: "follow_up",
      labelKey: "customers.basicAnalysis.fields.followUp",
    });
  } else if (input.lastFollowUpAt) {
    const days = Math.max(0, daysBetween(input.lastFollowUpAt, input.nowIso));
    // No invented follow-up cycle (no hardcoded 3/7/14/30). Severity only
    // escalates using the existing reclaim warning threshold.
    const atReclaimWarning = days >= input.reclaimWarningThresholdDays;
    if (days > 0) {
      findings.push({
        code: "FOLLOW_UP_DAYS_SINCE",
        severity: atReclaimWarning ? "warning" : "info",
        titleKey: "customers.basicAnalysis.findings.followUpDaysSince.title",
        descriptionKey:
          "customers.basicAnalysis.findings.followUpDaysSince.description",
        descriptionParams: { days: String(days) },
        evidence: {
          field: "lastFollowUpAt",
          value: input.lastFollowUpAt,
          days,
        },
        recommendedAction: {
          type: "ADD_FOLLOW_UP",
          labelKey: "customers.basicAnalysis.actions.addFollowUp",
        },
      });
    }
    if (!atReclaimWarning) {
      positiveSignals.push({
        code: "RECENT_FOLLOW_UP",
        titleKey: "customers.basicAnalysis.positive.recentFollowUp",
      });
    }
  }

  if (!hasText(input.nextFollowUpAt)) {
    missingData.push({
      field: "nextFollowUpAt",
      labelKey: "customers.basicAnalysis.fields.nextFollowUp",
    });
    findings.push({
      code: "NEXT_FOLLOW_UP_MISSING",
      severity: "warning",
      titleKey: "customers.basicAnalysis.findings.nextFollowUpMissing.title",
      descriptionKey:
        "customers.basicAnalysis.findings.nextFollowUpMissing.description",
      evidence: { field: "nextFollowUpAt", value: null },
      recommendedAction: {
        type: "SET_NEXT_FOLLOW_UP",
        labelKey: "customers.basicAnalysis.actions.setNextFollowUp",
      },
    });
  } else {
    const nextFollowUpAt = input.nextFollowUpAt.trim();
    if (nextFollowUpAt < input.nowIso) {
      const days = Math.max(0, daysBetween(nextFollowUpAt, input.nowIso));
      const hours = Math.max(0, hoursBetween(nextFollowUpAt, input.nowIso));
      findings.push({
        code: "FOLLOW_UP_OVERDUE",
        severity: "high",
        titleKey: "customers.basicAnalysis.findings.followUpOverdue.title",
        descriptionKey:
          "customers.basicAnalysis.findings.followUpOverdue.description",
        descriptionParams: {
          days: String(days),
          hours: String(hours),
        },
        evidence: {
          field: "nextFollowUpAt",
          value: nextFollowUpAt,
          days,
          hours,
        },
        recommendedAction: {
          type: "ADD_FOLLOW_UP",
          labelKey: "customers.basicAnalysis.actions.addFollowUpOverdue",
        },
      });
    } else {
      positiveSignals.push({
        code: "NEXT_FOLLOW_UP_SCHEDULED",
        titleKey: "customers.basicAnalysis.positive.nextFollowUpScheduled",
      });
    }
  }

  if (input.hasAnyFollowUp && !input.hasLatestNextAction) {
    missingData.push({
      field: "nextAction",
      labelKey: "customers.basicAnalysis.fields.nextAction",
    });
    findings.push({
      code: "NEXT_ACTION_MISSING",
      severity: "warning",
      titleKey: "customers.basicAnalysis.findings.nextActionMissing.title",
      descriptionKey:
        "customers.basicAnalysis.findings.nextActionMissing.description",
      evidence: { field: "nextAction", value: null, present: false },
      recommendedAction: {
        type: "SET_NEXT_ACTION",
        labelKey: "customers.basicAnalysis.actions.setNextAction",
      },
    });
  }

  if (input.reclaimEligible) {
    const daysLeft =
      input.automaticReclaimDays - input.daysWithoutValidFollowUp;
    const nearReclaim =
      input.daysWithoutValidFollowUp >= input.reclaimWarningThresholdDays;
    if (nearReclaim) {
      findings.push({
        code: "RECLAMATION_APPROACHING",
        severity: "high",
        titleKey:
          "customers.basicAnalysis.findings.reclamationApproaching.title",
        descriptionKey:
          "customers.basicAnalysis.findings.reclamationApproaching.description",
        descriptionParams: {
          daysWithoutValid: String(input.daysWithoutValidFollowUp),
          reclaimDays: String(input.automaticReclaimDays),
          daysLeft: String(Math.max(0, daysLeft)),
        },
        evidence: {
          field: "lastValidFollowUpAt",
          value: input.lastValidFollowUpAt,
          days: input.daysWithoutValidFollowUp,
        },
        recommendedAction: {
          type: "REVIEW_RECLAMATION",
          labelKey: "customers.basicAnalysis.actions.reviewReclamation",
        },
      });
    }
  }

  const uniqueFindings = dedupeFindings(findings);
  const nextRecommendedAction: BasicAnalysisRecommendedAction | null =
    uniqueFindings[0]?.recommendedAction ?? null;

  return {
    generatedAt: input.nowIso,
    source: BASIC_ANALYSIS_SOURCE,
    summaryStatus: summaryFromFindings(uniqueFindings),
    findings: uniqueFindings,
    positiveSignals,
    missingData,
    nextRecommendedAction,
  };
}
