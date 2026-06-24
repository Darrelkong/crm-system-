export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import {
  ExportValidationError,
  isExportScope,
  parseFieldsParam,
} from "@/lib/export/customers/constants";
import {
  exportCustomersCsv,
  parseExportCustomersQuery,
  recordInvalidExportFieldsFailure,
} from "@/lib/export/customers/service";
import { requireExportAdmin } from "@/lib/permissions/export";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    const user = await requireExportAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const url = new URL(request.url);
    const meta = { ipAddress, userAgent };

    let params;
    try {
      params = parseExportCustomersQuery(url.searchParams);
    } catch (error) {
      if (error instanceof ExportValidationError) {
        const scopeRaw = url.searchParams.get("scope") ?? "all_active";
        const scope = isExportScope(scopeRaw) ? scopeRaw : "all_active";
        const includeSensitiveParam = url.searchParams.get("includeSensitive");
        const includeSensitive =
          includeSensitiveParam === null || includeSensitiveParam === ""
            ? true
            : includeSensitiveParam === "true";

        await recordInvalidExportFieldsFailure(user, {
          scope,
          includeSensitive,
          invalidFields: error.invalidFields,
          requestedFields:
            parseFieldsParam(url.searchParams.get("fields")) ?? [],
          meta,
        });

        return Response.json(
          {
            error: error.message,
            code: error.code,
            invalidFields: error.invalidFields,
          },
          { status: 400 },
        );
      }
      throw error;
    }

    const result = await exportCustomersCsv(user, params, meta);

    return new Response(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "X-Export-Job-Id": result.jobId,
        "X-Exported-Count": String(result.exportedCount),
        "X-Export-Risk-Level": result.params.riskLevel,
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
