export const dynamic = "force-dynamic";

import { writeAuditLog } from "@/lib/audit/audit-log";
import { getRequestMeta } from "@/lib/auth/cookies";
import {
  createPrecheckImportJob,
} from "@/lib/import/customers/commit";
import { precheckCustomerImport } from "@/lib/import/customers/precheck";
import { readCsvFromRequest } from "@/lib/import/customers/request";
import { requireImportAdmin } from "@/lib/permissions/import";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function POST(request: Request) {
  try {
    const user = await requireImportAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);

    const { csvText, fileName } = await readCsvFromRequest(request);
    const precheck = await precheckCustomerImport(csvText, user);
    const jobId = await createPrecheckImportJob(user, fileName, precheck);

    await writeAuditLog({
      userId: user.id,
      action: "customers.import.precheck",
      entityType: "import_job",
      entityId: jobId,
      ipAddress,
      userAgent,
      metadata: {
        fileName,
        totalRows: precheck.totalRows,
        validRows: precheck.validRows,
        invalidRows: precheck.invalidRows,
        duplicateRows: precheck.duplicateRows,
      },
    });

    const { rows: _rows, ...result } = precheck;

    return Response.json({
      jobId,
      ...result,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("缺少") || error.message.startsWith("请上传"))
    ) {
      return Response.json(
        {
          error: error.message,
          errorCode: "IMPORT_FILE_REQUIRED",
        },
        { status: 400 },
      );
    }
    return authErrorResponse(error);
  }
}
