import { writeAuditLog } from "@/lib/audit/audit-log";
import type { Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import type { DownloadableMailAttachment } from "@/lib/mail/mail-attachment-download-service";

/**
 * Emitted after authorization succeeds and R2 bytes are retrieved.
 * Audit persistence failure must not block the download response.
 */
export async function recordMailAttachmentDownloaded(
  db: Database,
  actor: MailActorContext,
  attachment: Pick<
    DownloadableMailAttachment,
    "attachmentId" | "messageId" | "mailboxId"
  >,
): Promise<void> {
  try {
    await writeAuditLog(
      {
        userId: actor.userId,
        action: MAIL_AUDIT_ACTIONS.attachmentDownloaded,
        entityType: "mail_message_attachment",
        entityId: attachment.attachmentId,
        ipAddress: actor.audit.ipAddress ?? null,
        userAgent: actor.audit.userAgent ?? null,
        metadata: {
          messageId: attachment.messageId,
          mailboxId: attachment.mailboxId,
        },
      },
      db,
    );
  } catch {
    // Non-blocking by design — download authorization already succeeded.
  }
}
