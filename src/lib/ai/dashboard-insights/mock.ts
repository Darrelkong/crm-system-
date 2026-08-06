import type { DashboardAiInsightType } from "./types";
import type { AdminAiProviderContext } from "./context/admin-context";
import type { StaffAiProviderContext } from "./context/staff-context";
import {
  buildDeterministicAdminBrief,
  buildDeterministicStaffActions,
} from "./fallback";

export function generateMockDashboardAiOutput(
  insightType: DashboardAiInsightType,
  context: unknown,
): unknown {
  if (insightType === "admin_management_brief") {
    return buildDeterministicAdminBrief(context as AdminAiProviderContext);
  }
  return buildDeterministicStaffActions(context as StaffAiProviderContext);
}
