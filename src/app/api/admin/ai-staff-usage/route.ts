export const dynamic = "force-dynamic";

import { authErrorResponse } from "@/lib/permissions/auth";
import { requireUserManagementAdmin } from "@/lib/permissions/user-management";
import { getDb } from "@/lib/db";
import { getEffectiveAiSettings } from "@/lib/settings/ai-effective";
import {
  getAdminStaffAiUsageStats,
  type AdminStaffAiUsageStats,
} from "@/lib/ai/staff-usage/admin-stats";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import type { User } from "../../../../../drizzle/schema/users";

export type AdminAiStaffUsageRouteDeps = {
  requireAdmin: (request: Request) => Promise<User>;
  getEffectiveAiSettings: () => Promise<EffectiveAiSettings>;
  getAdminStaffAiUsageStats: (
    settings: EffectiveAiSettings,
  ) => Promise<AdminStaffAiUsageStats>;
};

function defaultDeps(): AdminAiStaffUsageRouteDeps {
  return {
    requireAdmin: (request) => requireUserManagementAdmin(request),
    getEffectiveAiSettings: async () => getEffectiveAiSettings(getDb()),
    getAdminStaffAiUsageStats: async (settings) =>
      getAdminStaffAiUsageStats(getDb(), settings),
  };
}

export async function handleAdminAiStaffUsageGet(
  request: Request,
  deps: AdminAiStaffUsageRouteDeps = defaultDeps(),
): Promise<Response> {
  try {
    await deps.requireAdmin(request);
    const settings = await deps.getEffectiveAiSettings();
    const stats = await deps.getAdminStaffAiUsageStats(settings);
    return Response.json({ stats });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleAdminAiStaffUsageGet(request);
}
