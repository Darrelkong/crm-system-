export const dynamic = "force-dynamic";

import { requireStaff, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { getStaffDashboardStats } from "@/lib/reports/staff-dashboard";

/**
 * Staff-only dashboard stats. Admin users receive 403 and should use
 * GET /api/reports/admin-dashboard for global metrics.
 */
export async function GET(request: Request) {
  try {
    const user = await requireStaff(request);
    const db = getDb();
    const stats = await getStaffDashboardStats(db, user);
    return Response.json(stats);
  } catch (error) {
    return authErrorResponse(error);
  }
}
