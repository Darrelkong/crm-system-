import type { StaffCustomerRefMap } from "./customer-ref";
import {
  safeParseAdminBriefInsight,
  safeParseStaffTodayActionsInsight,
} from "./schemas";
import type {
  AdminBriefInsight,
  DashboardAiInsightPayload,
  DashboardAiInsightType,
  ResolvedStaffAction,
  StaffTodayActionsInsight,
} from "./types";

export function validateDashboardAiProviderOutput(
  insightType: DashboardAiInsightType,
  raw: unknown,
  refMap?: StaffCustomerRefMap,
):
  | { ok: true; payload: DashboardAiInsightPayload }
  | { ok: false } {
  if (insightType === "admin_management_brief") {
    const parsed = safeParseAdminBriefInsight(raw);
    if (!parsed.success) return { ok: false };
    return {
      ok: true,
      payload: {
        insightType,
        insight: parsed.data as AdminBriefInsight,
      },
    };
  }

  const parsed = safeParseStaffTodayActionsInsight(raw);
  if (!parsed.success) return { ok: false };

  const filteredActions: StaffTodayActionsInsight["actions"] = [];
  const resolvedActions: ResolvedStaffAction[] = [];

  for (const action of parsed.data.actions) {
    if (action.customerRef && refMap) {
      const resolved = refMap.resolveRef(action.customerRef);
      if (!resolved.authorized) {
        continue;
      }
      filteredActions.push(action);
      resolvedActions.push({
        ...action,
        customerId: resolved.entry?.customerId,
        customerHref: resolved.entry?.href,
        customerDisplayLabel: resolved.entry?.displayLabel,
      });
      continue;
    }
    filteredActions.push(action);
    resolvedActions.push({ ...action });
  }

  return {
    ok: true,
    payload: {
      insightType,
      insight: {
        headline: parsed.data.headline,
        actions: filteredActions,
      },
      resolvedActions,
    },
  };
}
