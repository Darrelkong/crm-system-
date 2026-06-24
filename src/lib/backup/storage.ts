import type { R2PutBinding } from "@/lib/backup/r2-types";
import type { StorageProvider } from "../../../drizzle/schema/backup-jobs";
import { BUSINESS_UTC_OFFSET_MS } from "@/lib/reports/dates";

export function getBackupFileTimestamp(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + BUSINESS_UTC_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  const h = String(shifted.getUTCHours()).padStart(2, "0");
  const min = String(shifted.getUTCMinutes()).padStart(2, "0");
  const s = String(shifted.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}${min}${s}`;
}

export function buildBackupFileName(timestamp: string): string {
  return `crm-backup-${timestamp}.json`;
}

export function buildBackupStorageKey(fileName: string): string {
  return `backups/${fileName}`;
}

export type BackupWriteResult = {
  storageProvider: StorageProvider;
  storageKey: string;
  localPath?: string;
};

export async function writeBackupPayload(
  storageKey: string,
  body: string,
  r2?: R2PutBinding | null,
  allowLocalFallback = false,
): Promise<BackupWriteResult> {
  if (process.env.BACKUP_FORCE_FAIL === "1") {
    throw new Error("BACKUP_FORCE_FAIL: simulated storage failure");
  }

  if (r2) {
    try {
      await r2.put(storageKey, body, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      });
      return { storageProvider: "r2", storageKey };
    } catch (error) {
      if (!allowLocalFallback) {
        throw error;
      }
      console.warn("[backup] R2 write failed, falling back to local:", error);
    }
  }

  if (allowLocalFallback) {
    const { writeLocalBackup } = await import("@/lib/backup/storage-local");
    return writeLocalBackup(storageKey, body);
  }

  throw new Error("备份存储不可用：未配置 R2 且不允许本地回退");
}
