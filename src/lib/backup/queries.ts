import { desc } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

export type BackupJobListItem = {
  id: string;
  status: string;
  backupType: string;
  triggeredBy: string | null;
  fileName: string | null;
  storageProvider: string | null;
  tableCount: number;
  recordCount: number;
  fileSizeBytes: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export async function listBackupJobs(
  db: Database,
  limit = 50,
): Promise<BackupJobListItem[]> {
  const rows = await db
    .select({
      id: schema.backupJobs.id,
      status: schema.backupJobs.status,
      backupType: schema.backupJobs.backupType,
      triggeredBy: schema.backupJobs.triggeredBy,
      fileName: schema.backupJobs.fileName,
      storageProvider: schema.backupJobs.storageProvider,
      tableCount: schema.backupJobs.tableCount,
      recordCount: schema.backupJobs.recordCount,
      fileSizeBytes: schema.backupJobs.fileSizeBytes,
      errorMessage: schema.backupJobs.errorMessage,
      startedAt: schema.backupJobs.startedAt,
      completedAt: schema.backupJobs.completedAt,
      createdAt: schema.backupJobs.createdAt,
    })
    .from(schema.backupJobs)
    .orderBy(desc(schema.backupJobs.createdAt))
    .limit(limit);

  return rows;
}
