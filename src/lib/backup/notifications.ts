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

  for (const admin of admins) {
    await createNotification(db, {
      userId: admin.id,
      type: "backup_failed",
      titleKey: "notificationTypes.backup_failed",
      messageKey: "notificationMessages.backupFailed",
      messageParams: { errorMessage: input.errorMessage },
      relatedEntityType: "backup_job",
      relatedEntityId: input.backupJobId,
    });
  }
}
