import { eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { resolveMailAttachmentDownloadFilename } from "@/lib/mail/mail-attachment-download-content-disposition";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertCanReadMessageForPublicApi,
  type MailMessageReadContext,
} from "@/lib/mail/message-read-permissions";
import { resolveMailAttachmentDownloadable } from "@/lib/mail/mail-attachment-preview";

export type DownloadableMailAttachment = {
  attachmentId: string;
  messageId: string;
  mailboxId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Server-only R2 locator — must never appear in API JSON responses. */
  storageKey: string;
};

async function assertCanDownloadAttachmentFromMessage(
  db: Database,
  actor: MailActorContext,
  messageId: string,
  context?: MailMessageReadContext,
) {
  return assertCanReadMessageForPublicApi(db, actor, messageId, context);
}

export function assertStoredFileRelationshipIntegrity(
  attachment: {
    storedFileId: string;
    contentHash: string;
  },
  storedFile: {
    id: string;
    contentHash: string;
  } | undefined,
): asserts storedFile is { id: string; contentHash: string } {
  if (!storedFile) {
    throw MailServiceError.notFound();
  }
  if (
    storedFile.id !== attachment.storedFileId ||
    storedFile.contentHash !== attachment.contentHash
  ) {
    throw MailServiceError.notFound();
  }
}

export function assertAttachmentDownloadEligibility(input: {
  deliveryMode: string;
  securityScanStatus: string;
}): void {
  if (
    !resolveMailAttachmentDownloadable({
      deliveryMode: input.deliveryMode,
      securityScanStatus: input.securityScanStatus,
    })
  ) {
    throw MailServiceError.notFound();
  }
}

export async function resolveDownloadableMailAttachment(
  db: Database,
  actor: MailActorContext,
  attachmentId: string,
  context?: MailMessageReadContext,
): Promise<DownloadableMailAttachment> {
  const [attachment] = await db
    .select()
    .from(schema.mailMessageAttachments)
    .where(eq(schema.mailMessageAttachments.id, attachmentId))
    .limit(1);

  if (!attachment) {
    throw MailServiceError.notFound();
  }

  const { message } = await assertCanDownloadAttachmentFromMessage(
    db,
    actor,
    attachment.messageId,
    context,
  );

  const [storedFile] = await db
    .select()
    .from(schema.mailStoredFiles)
    .where(eq(schema.mailStoredFiles.id, attachment.storedFileId))
    .limit(1);

  assertStoredFileRelationshipIntegrity(attachment, storedFile);
  if (
    storedFile.sizeBytes !== attachment.sizeBytes ||
    storedFile.storageProvider !== "r2"
  ) {
    throw MailServiceError.notFound();
  }
  assertAttachmentDownloadEligibility({
    deliveryMode: attachment.deliveryMode,
    securityScanStatus: storedFile.securityScanStatus,
  });

  return {
    attachmentId: attachment.id,
    messageId: attachment.messageId,
    mailboxId: message.mailboxId,
    filename: resolveMailAttachmentDownloadFilename({
      displayFilename: attachment.displayFilename,
      originalFilename: attachment.originalFilename,
    }),
    mimeType: storedFile.mimeType,
    sizeBytes: storedFile.sizeBytes,
    storageKey: storedFile.storageKey,
  };
}
