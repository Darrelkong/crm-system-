export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { commitCustomerImport } from "@/lib/import/customers/commit";
import { ImportJobGuardError } from "@/lib/import/customers/job-guard";
import { readCommitBody } from "@/lib/import/customers/request";
import { requireImportAdmin } from "@/lib/permissions/import";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function POST(request: Request) {
  try {
    const user = await requireImportAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);

    const { csvText, fileName, jobId } = await readCommitBody(request);

    if (!jobId) {
      return Response.json(
        { error: "缺少 jobId，请先预检", errorCode: "MISSING_JOB_ID" },
        { status: 400 },
      );
    }

    const result = await commitCustomerImport({
      csvText,
      fileName,
      user,
      ipAddress,
      userAgent,
      jobId,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof ImportJobGuardError) {
      return Response.json(
        { error: error.message, code: error.code, errorCode: error.code },
        { status: error.status },
      );
    }
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
