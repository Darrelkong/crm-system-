export const dynamic = "force-dynamic";

import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { getAdminDashboardStats } from "@/lib/reports/admin-dashboard";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const db = getDb();
    const stats = await getAdminDashboardStats(db);
    return Response.json(stats);
  } catch (error) {
    return authErrorResponse(error);
  }
}
