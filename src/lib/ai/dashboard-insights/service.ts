import type { Database } from "@/lib/db";
import { getDb } from "@/lib/db";
import { DashboardAiPermissionError } from "./errors";
import { generateAdminManagementBriefInsight } from "./admin-insight";
import { generateStaffTodayActionsInsight } from "./staff-insight";
import type {
  DashboardAiInsightResult,
  GenerateDashboardAiInsightInput,
} from "./types";

function assertInsightTypeAllowedForViewer(
  input: GenerateDashboardAiInsightInput,
): void {
  if (
    input.insightType === "admin_management_brief" &&
    input.viewer.role !== "admin"
  ) {
    throw new DashboardAiPermissionError();
  }
  if (
    input.insightType === "staff_today_actions" &&
    input.viewer.role !== "staff"
  ) {
    throw new DashboardAiPermissionError();
  }
}

export async function generateDashboardAiInsight(
  input: GenerateDashboardAiInsightInput,
  db: Database = getDb(),
): Promise<DashboardAiInsightResult> {
  assertInsightTypeAllowedForViewer(input);

  if (input.insightType === "admin_management_brief") {
    return generateAdminManagementBriefInsight(input, db);
  }

  return generateStaffTodayActionsInsight(input, db);
}
