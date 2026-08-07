import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import type { AiAnalysisLanguage } from "@/lib/settings/ai-keys";
import type {
  AdminBriefInsight,
  AdminBriefPriorityCategory,
  DashboardAiInsightResult,
  DashboardAiInsightSource,
  DashboardAiResultStatus,
  DashboardAiUrgency,
  ResolvedStaffAction,
  StaffActionCategory,
} from "./types";

export type DashboardAiPublicCustomerLink = {
  label: string;
  href: string;
};

export type DashboardAiPublicStaffAction = {
  category: StaffActionCategory;
  title: string;
  reason: string;
  urgency: DashboardAiUrgency;
  customer?: DashboardAiPublicCustomerLink;
};

export type DashboardAiPublicAdminPriority = {
  category: AdminBriefPriorityCategory;
  title: string;
  reason: string;
  urgency: DashboardAiUrgency;
};

export type DashboardAiPublicInsight =
  | {
      insightType: "admin_management_brief";
      headline: string;
      summary: string;
      priorities: DashboardAiPublicAdminPriority[];
      cautions: string[];
    }
  | {
      insightType: "staff_today_actions";
      headline: string;
      actions: DashboardAiPublicStaffAction[];
    };

export type DashboardAiPublicResponse = {
  status: DashboardAiResultStatus;
  source: DashboardAiInsightSource | null;
  cached: boolean;
  message?: string;
  insight?: DashboardAiPublicInsight;
};

const SAFE_INTERNAL_HREF =
  /^\/(customers|work-items|approvals|public-pool)(\/[\w.-]+)?(\?[\w&=%-]+)?$/;

export function isSafeDashboardAiHref(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  if (/^(javascript|data|vbscript):/i.test(href)) return false;
  if (href.includes("://")) return false;
  return SAFE_INTERNAL_HREF.test(href.split("#")[0] ?? href);
}

export function resolveDashboardAiLocale(
  raw: string | null | undefined,
): AiAnalysisLanguage {
  if (raw && isLocale(raw)) {
    return raw as AiAnalysisLanguage;
  }
  return "en";
}

export function localeFromUi(locale: Locale): AiAnalysisLanguage {
  return locale;
}

export function mapAdminPriorityHref(
  category: AdminBriefPriorityCategory,
): string {
  switch (category) {
    case "approvals":
      return "/approvals";
    case "reclamation":
      return "/customers?reclamationRisk=team";
    case "follow_up":
      return "/customers?workView=overdue";
    case "public_pool":
      return "/public-pool";
    case "pipeline":
      return "/customers";
    default:
      return "/customers";
  }
}

export function mapStaffCategoryHref(category: StaffActionCategory): string {
  switch (category) {
    case "overdue":
      return "/customers?workView=overdue";
    case "reclamation":
      return "/customers?reclamationRisk=mine";
    case "work_item":
      return "/work-items";
    case "follow_up":
      return "/customers?workView=dueToday";
    default:
      return "/work-items";
  }
}

export function toDashboardAiPublicResponse(
  result: DashboardAiInsightResult,
): DashboardAiPublicResponse {
  const base: DashboardAiPublicResponse = {
    status: result.status,
    source: result.source ?? null,
    cached: Boolean(result.cacheHit),
  };

  if (result.status !== "success" || !result.payload) {
    return {
      ...base,
      message: result.message,
    };
  }

  if (result.payload.insightType === "admin_management_brief") {
    const insight: AdminBriefInsight = result.payload.insight;
    return {
      ...base,
      insight: {
        insightType: "admin_management_brief",
        headline: insight.headline,
        summary: insight.summary,
        priorities: insight.priorities.map((priority) => ({
          category: priority.category,
          title: priority.title,
          reason: priority.reason,
          urgency: priority.urgency,
        })),
        cautions: [...insight.cautions],
      },
    };
  }

  const resolved: ResolvedStaffAction[] =
    result.payload.resolvedActions ??
    result.payload.insight.actions.map((action) => ({ ...action }));

  return {
    ...base,
    insight: {
      insightType: "staff_today_actions",
      headline: result.payload.insight.headline,
      actions: resolved.map((action) => {
        const publicAction: DashboardAiPublicStaffAction = {
          category: action.category,
          title: action.title,
          reason: action.reason,
          urgency: action.urgency,
        };
        if (
          action.customerHref &&
          action.customerDisplayLabel &&
          isSafeDashboardAiHref(action.customerHref)
        ) {
          publicAction.customer = {
            label: action.customerDisplayLabel,
            href: action.customerHref,
          };
        }
        return publicAction;
      }),
    },
  };
}
