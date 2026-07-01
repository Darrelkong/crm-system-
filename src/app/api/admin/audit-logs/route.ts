export const dynamic = "force-dynamic";

import { getAuditLogsForAdmin, parseAuditLogListParams } from "@/lib/audit/audit-api";
import { getDb } from "@/lib/db";
import { authErrorResponse, requireAdmin } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    const filters = parseAuditLogListParams(new URL(request.url));
    const result = await getAuditLogsForAdmin(user, getDb(), filters);
    return Response.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
