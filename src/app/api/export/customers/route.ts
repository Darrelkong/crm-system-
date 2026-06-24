export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import {
  exportCustomersCsv,
  parseExportCustomersQuery,
} from "@/lib/export/customers/service";
import { requireExportAdmin } from "@/lib/permissions/export";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    const user = await requireExportAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const url = new URL(request.url);
    const params = parseExportCustomersQuery(url.searchParams);

    const result = await exportCustomersCsv(user, params, {
      ipAddress,
      userAgent,
    });

    return new Response(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "X-Export-Job-Id": result.jobId,
        "X-Exported-Count": String(result.exportedCount),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
