import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";

export async function notifyAdminsBackupFailed(
  db: Database,
  input: { backupJobId: string; errorMessage: string },
): Promise<void> {
  const admins = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.role, "admin"));

  const message = `系统备份失败，请尽快检查。错误：${input.errorMessage}`;

  for (const admin of admins) {
    await createNotification(db, {
      userId: admin.id,
      type: "backup_failed",
      title: "系统备份失败",
      message,
      relatedEntityType: "backup_job",
      relatedEntityId: input.backupJobId,
    });
  }
}
