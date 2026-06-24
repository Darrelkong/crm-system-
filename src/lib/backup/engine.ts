import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import {
  BACKUP_AUDIT_ACTIONS,
  BACKUP_VERSION,
} from "@/lib/backup/constants";
import {
  collectBackupTableData,
  countBackupRecords,
} from "@/lib/backup/export-data";
import { notifyAdminsBackupFailed } from "@/lib/backup/notifications";
import {
  buildBackupFileName,
  buildBackupStorageKey,
  getBackupFileTimestamp,
  writeBackupPayload,
} from "@/lib/backup/storage";
import type { R2PutBinding } from "@/lib/backup/r2-types";
import type { BackupType } from "../../../drizzle/schema/backup-jobs";

export type RunBackupOptions = {
  db: Database;
  r2?: R2PutBinding | null;
  backupType: BackupType;
  triggeredBy: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  environment?: string;
  allowLocalFallback?: boolean;
};

export type RunBackupResult = {
  backupJobId: string;
  status: "completed" | "failed";
  fileName: string | null;
  storageKey: string | null;
  tableCount: number;
  recordCount: number;
  fileSizeBytes: number;
  errorMessage?: string;
};

export async function runDatabaseBackup(
  options: RunBackupOptions,
): Promise<RunBackupResult> {
  const {
    db,
    r2,
    backupType,
    triggeredBy,
    ipAddress,
    userAgent,
    environment = process.env.NODE_ENV ?? "development",
    allowLocalFallback = false,
  } = options;

  const jobId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const timestamp = getBackupFileTimestamp(new Date(startedAt));
  const fileName = buildBackupFileName(timestamp);
  const storageKey = buildBackupStorageKey(fileName);

  await db.insert(schema.backupJobs).values({
    id: jobId,
    status: "running",
    backupType,
    triggeredBy,
    fileName,
    storageProvider: null,
    storageKey: null,
    tableCount: 0,
    recordCount: 0,
    fileSizeBytes: 0,
    errorMessage: null,
    startedAt,
    completedAt: null,
    createdAt: startedAt,
  });

  await writeAuditLog(
    {
      userId: triggeredBy,
      action: BACKUP_AUDIT_ACTIONS.started,
      entityType: "backup_job",
      entityId: jobId,
      ipAddress,
      userAgent,
      metadata: { backupType, fileName },
    },
    db,
  );

  try {
    const tables = await collectBackupTableData(db, jobId);
    const { tableCount, recordCount } = countBackupRecords(tables);

    const payload = {
      version: BACKUP_VERSION,
      generatedAt: new Date().toISOString(),
      environment,
      tables,
      metadata: {
        tableCount,
        recordCount,
        excludedFields: {
          users: ["password_hash"],
          sessions: "table excluded entirely (token_hash)",
        },
      },
    };

    const body = JSON.stringify(payload, null, 2);
    const fileSizeBytes = new TextEncoder().encode(body).length;

    const writeResult = await writeBackupPayload(
      storageKey,
      body,
      r2,
      allowLocalFallback,
    );
    const completedAt = new Date().toISOString();

    await db
      .update(schema.backupJobs)
      .set({
        status: "completed",
        storageProvider: writeResult.storageProvider,
        storageKey: writeResult.storageKey,
        tableCount,
        recordCount,
        fileSizeBytes,
        completedAt,
      })
      .where(eq(schema.backupJobs.id, jobId));

    await writeAuditLog(
      {
        userId: triggeredBy,
        action: BACKUP_AUDIT_ACTIONS.completed,
        entityType: "backup_job",
        entityId: jobId,
        ipAddress,
        userAgent,
        metadata: {
          backupType,
          fileName,
          storageProvider: writeResult.storageProvider,
          tableCount,
          recordCount,
          fileSizeBytes,
        },
      },
      db,
    );

    return {
      backupJobId: jobId,
      status: "completed",
      fileName,
      storageKey: writeResult.storageKey,
      tableCount,
      recordCount,
      fileSizeBytes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = new Date().toISOString();

    await db
      .update(schema.backupJobs)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt,
      })
      .where(eq(schema.backupJobs.id, jobId));

    await writeAuditLog(
      {
        userId: triggeredBy,
        action: BACKUP_AUDIT_ACTIONS.failed,
        entityType: "backup_job",
        entityId: jobId,
        ipAddress,
        userAgent,
        metadata: { backupType, fileName, error: message },
      },
      db,
    );

    await notifyAdminsBackupFailed(db, {
      backupJobId: jobId,
      errorMessage: message,
    });

    return {
      backupJobId: jobId,
      status: "failed",
      fileName,
      storageKey: null,
      tableCount: 0,
      recordCount: 0,
      fileSizeBytes: 0,
      errorMessage: message,
    };
  }
}
