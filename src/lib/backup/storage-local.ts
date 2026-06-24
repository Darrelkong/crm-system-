import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackupWriteResult } from "@/lib/backup/storage";

/** Dev-only fallback when R2 is unavailable (not used in production Workers). */
export async function writeLocalBackup(
  storageKey: string,
  body: string,
): Promise<BackupWriteResult> {
  const localDir = join(process.cwd(), ".local-backups");
  await mkdir(localDir, { recursive: true });
  const localFile = storageKey.replace(/\//g, "_");
  const localPath = join(localDir, localFile);
  await writeFile(localPath, body, "utf8");
  return {
    storageProvider: "local",
    storageKey,
    localPath,
  };
}
