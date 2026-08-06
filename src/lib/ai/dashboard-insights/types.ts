import type { AiAnalysisLanguage } from "@/lib/settings/ai-keys";
import type { User } from "../../../../drizzle/schema/users";

export const DASHBOARD_AI_INSIGHT_TYPES = [
  "admin_management_brief",
  "staff_today_actions",
] as const;

export type DashboardAiInsightType = (typeof DASHBOARD_AI_INSIGHT_TYPES)[number];

export const DASHBOARD_AI_RESULT_STATUSES = [
  "success",
  "unavailable",
  "disabled",
  "rate_limited",
  "timeout",
  "invalid_response",
] as const;

export type DashboardAiResultStatus =
  (typeof DASHBOARD_AI_RESULT_STATUSES)[number];

export type DashboardAiInsightSource = "provider" | "mock" | "system_fallback";

export type DashboardAiUrgency = "normal" | "attention" | "urgent";

export type AdminBriefPriorityCategory =
  | "approvals"
  | "follow_up"
  | "reclamation"
  | "public_pool"
  | "pipeline";

export type StaffActionCategory =
  | "follow_up"
  | "overdue"
  | "reclamation"
  | "work_item";

export type AdminBriefInsight = {
  headline: string;
  summary: string;
  priorities: Array<{
    category: AdminBriefPriorityCategory;
    title: string;
    reason: string;
    urgency: DashboardAiUrgency;
  }>;
  cautions: string[];
};

export type StaffTodayActionsInsight = {
  headline: string;
  actions: Array<{
    customerRef?: string;
    category: StaffActionCategory;
    title: string;
    reason: string;
    urgency: DashboardAiUrgency;
  }>;
};

export type ResolvedStaffAction = StaffTodayActionsInsight["actions"][number] & {
  customerId?: string;
  customerHref?: string;
  customerDisplayLabel?: string;
};

export type DashboardAiInsightPayload =
  | { insightType: "admin_management_brief"; insight: AdminBriefInsight }
  | {
      insightType: "staff_today_actions";
      insight: StaffTodayActionsInsight;
      resolvedActions?: ResolvedStaffAction[];
    };

export type DashboardAiInsightResult = {
  status: DashboardAiResultStatus;
  source?: DashboardAiInsightSource;
  message?: string;
  fingerprint?: string;
  cacheHit?: boolean;
  payload?: DashboardAiInsightPayload;
};

export type GenerateDashboardAiInsightInput = {
  viewer: User;
  insightType: DashboardAiInsightType;
  locale: AiAnalysisLanguage;
  now?: Date;
  forceRefresh?: boolean;
};
