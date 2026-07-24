export const BASIC_ANALYSIS_SOURCE = "system_rules" as const;

export type BasicAnalysisSeverity = "info" | "warning" | "high";

export type BasicAnalysisSummaryStatus = "normal" | "attention" | "urgent";

export type BasicAnalysisFindingCode =
  | "FOLLOW_UP_NEVER"
  | "FOLLOW_UP_DAYS_SINCE"
  | "FOLLOW_UP_OVERDUE"
  | "NEXT_FOLLOW_UP_MISSING"
  | "CONTACT_MISSING"
  | "CUSTOMER_NAME_MISSING"
  | "BUSINESS_NEED_MISSING"
  | "NEXT_ACTION_MISSING"
  | "RECLAMATION_APPROACHING"
  | "SALES_STAGE_MISSING";

export type BasicAnalysisActionType =
  | "ADD_FOLLOW_UP"
  | "SET_NEXT_FOLLOW_UP"
  | "SET_NEXT_ACTION"
  | "COMPLETE_PROFILE"
  | "REVIEW_STAGE"
  | "REVIEW_RECLAMATION";

export type BasicAnalysisEvidence = {
  field: string;
  /** Safe scalar only: ISO timestamp, null, or never phone/wechat/email/body. */
  value: string | null;
  days?: number;
  hours?: number;
  present?: boolean;
};

export type BasicAnalysisRecommendedAction = {
  type: BasicAnalysisActionType;
  labelKey: string;
  reasonKey?: string;
};

export type BasicAnalysisFinding = {
  code: BasicAnalysisFindingCode;
  severity: BasicAnalysisSeverity;
  titleKey: string;
  descriptionKey: string;
  descriptionParams?: Record<string, string>;
  evidence: BasicAnalysisEvidence;
  recommendedAction: BasicAnalysisRecommendedAction;
};

export type BasicCustomerAnalysis = {
  generatedAt: string;
  source: typeof BASIC_ANALYSIS_SOURCE;
  summaryStatus: BasicAnalysisSummaryStatus;
  findings: BasicAnalysisFinding[];
  positiveSignals: Array<{ code: string; titleKey: string }>;
  missingData: Array<{ field: string; labelKey: string }>;
  nextRecommendedAction: BasicAnalysisRecommendedAction | null;
};

/** Minimal CRM snapshot for deterministic rule evaluation (no follow-up bodies). */
export type BasicAnalysisInput = {
  nowIso: string;
  customerName: string | null;
  phone: string | null;
  wechatId: string | null;
  requestedProjectName: string | null;
  salesStage: string | null;
  lastFollowUpAt: string | null;
  lastValidFollowUpAt: string | null;
  nextFollowUpAt: string | null;
  /** Whether latest follow-up has a non-empty next_action (text never carried). */
  hasLatestNextAction: boolean;
  hasAnyFollowUp: boolean;
  reclaimEligible: boolean;
  automaticReclaimDays: number;
  reclaimWarningThresholdDays: number;
  daysWithoutValidFollowUp: number;
};
