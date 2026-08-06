import type { Database } from "@/lib/db";
import type { User } from "../../../../../drizzle/schema/users";
import type { DashboardAiInsightType } from "../types";
import { DashboardAiPermissionError } from "../errors";
import { buildAdminAiContext } from "./admin-context";
import { buildStaffAiContext } from "./staff-context";
import type { StaffCustomerRefMap } from "../customer-ref";

export type DashboardAiContextBundle = {
  providerContext: unknown;
  refMap?: StaffCustomerRefMap;
};

export async function buildDashboardAiContext(
  db: Database,
  viewer: User,
  insightType: DashboardAiInsightType,
  now: Date,
): Promise<DashboardAiContextBundle> {
  if (insightType === "admin_management_brief") {
    if (viewer.role !== "admin") {
      throw new DashboardAiPermissionError();
    }
    const { providerContext } = await buildAdminAiContext(db, viewer, now);
    return { providerContext };
  }

  if (insightType === "staff_today_actions") {
    if (viewer.role !== "staff") {
      throw new DashboardAiPermissionError();
    }
    const { providerContext, refMap } = await buildStaffAiContext(
      db,
      viewer,
      now,
    );
    return { providerContext, refMap };
  }

  throw new DashboardAiPermissionError("Unsupported insight type");
}
