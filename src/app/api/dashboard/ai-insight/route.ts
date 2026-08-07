export const dynamic = "force-dynamic";

import {
  authErrorResponse,
  requireAuth,
} from "@/lib/permissions/auth";
import { getDb, type Database } from "@/lib/db";
import {
  generateDashboardAiInsight,
  type DashboardAiInsightType,
} from "@/lib/ai/dashboard-insights";
import {
  resolveDashboardAiLocale,
  toDashboardAiPublicResponse,
} from "@/lib/ai/dashboard-insights/api-response";
import { DashboardAiPermissionError } from "@/lib/ai/dashboard-insights/errors";
import type { User } from "../../../../../drizzle/schema/users";

export type DashboardAiInsightRouteDeps = {
  requireAuth: (request?: Request) => Promise<User>;
  getDb: () => Database;
  generateDashboardAiInsight: typeof generateDashboardAiInsight;
};

const defaultDeps: DashboardAiInsightRouteDeps = {
  requireAuth,
  getDb,
  generateDashboardAiInsight,
};

/**
 * Dashboard AI insight for the authenticated viewer.
 * Server derives insightType from role; clients cannot escalate privileges.
 */
export async function handleDashboardAiInsightGet(
  request: Request,
  deps: DashboardAiInsightRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const user = await deps.requireAuth(request);
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("forceRefresh") === "1";
    const locale = resolveDashboardAiLocale(url.searchParams.get("locale"));

    // Client-supplied insightType / userId / role are ignored.
    let insightType: DashboardAiInsightType;
    if (user.role === "admin") {
      insightType = "admin_management_brief";
    } else if (user.role === "staff") {
      insightType = "staff_today_actions";
    } else {
      return Response.json(
        { error: "Forbidden", errorCode: "FORBIDDEN" },
        { status: 403 },
      );
    }

    const result = await deps.generateDashboardAiInsight(
      {
        viewer: user,
        insightType,
        locale,
        forceRefresh,
      },
      deps.getDb(),
    );

    return Response.json(toDashboardAiPublicResponse(result));
  } catch (error) {
    if (error instanceof DashboardAiPermissionError) {
      return Response.json(
        { error: "Forbidden", errorCode: "FORBIDDEN" },
        { status: 403 },
      );
    }
    return authErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleDashboardAiInsightGet(request);
}
