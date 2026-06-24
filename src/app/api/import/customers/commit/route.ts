export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { commitCustomerImport } from "@/lib/import/customers/commit";
import { readCommitBody } from "@/lib/import/customers/request";
import { requireImportAdmin } from "@/lib/permissions/import";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function POST(request: Request) {
  try {
    const user = await requireImportAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);

    const { csvText, fileName, jobId, skipWarnings } =
      await readCommitBody(request);

    const result = await commitCustomerImport({
      csvText,
      fileName,
      skipWarnings,
      user,
      ipAddress,
      userAgent,
      jobId,
    });

    if (result.failedCount > 0 || result.errors.length > 0) {
      return Response.json(
        {
          error: "存在错误行，无法导入",
          ...result,
        },
        { status: 400 },
      );
    }

    return Response.json(result);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("缺少") || error.message.startsWith("请上传"))
    ) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
