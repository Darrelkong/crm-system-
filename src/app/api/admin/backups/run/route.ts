export const dynamic = "force-dynamic";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getRequestMeta } from "@/lib/auth/cookies";
import { runDatabaseBackup } from "@/lib/backup/engine";
import { getDb } from "@/lib/db";
import { requireBackupAdmin } from "@/lib/permissions/backup";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function POST(request: Request) {
  try {
    const user = await requireBackupAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const { env } = await getCloudflareContext({ async: true });

    const result = await runDatabaseBackup({
      db: getDb(),
      r2: env.ATTACHMENTS ?? null,
      backupType: "manual",
      triggeredBy: user.id,
      ipAddress,
      userAgent,
      environment: process.env.NODE_ENV ?? "development",
      allowLocalFallback: process.env.NODE_ENV !== "production",
    });

    if (result.status === "failed") {
      return Response.json(
        {
          error: result.errorMessage ?? "备份失败",
          ...result,
        },
        { status: 500 },
      );
    }

    return Response.json({
      backupJobId: result.backupJobId,
      status: result.status,
      fileName: result.fileName,
      storageKey: result.storageKey,
      tableCount: result.tableCount,
      recordCount: result.recordCount,
      fileSizeBytes: result.fileSizeBytes,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
