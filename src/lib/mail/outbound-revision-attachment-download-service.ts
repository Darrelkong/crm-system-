import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import { resolveMailAttachmentDownloadFilename } from "@/lib/mail/mail-attachment-download-content-disposition";
import {
  assertAttachmentDownloadEligibility,
  assertStoredFileRelationshipIntegrity,
} from "@/lib/mail/mail-attachment-download-service";
import { assertEffectiveMailAccess, hasMailOutboundApprovalReview } from "@/lib/permissions/mail";

export type DownloadableOutboundRevisionAttachment = {
  attachmentId: string;
  revisionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
};

async function assertOutboundRevisionAttachmentReadAccess(
  db: Database,
  actor: MailActorContext,
  revision: { id: string; revisionChainId: string; createdByUserId: string },
): Promise<void> {
  assertEffectiveMailAccess(actor);
  if (revision.createdByUserId === actor.userId) {
    return;
  }
  if (!hasMailOutboundApprovalReview(actor)) {
    throw MailServiceError.forbidden("Outbound revision attachment access denied");
  }
  const [approval] = await db
    .select({ id: schema.mailOutboundApprovals.id })
    .from(schema.mailOutboundApprovals)
    .where(eq(schema.mailOutboundApprovals.revisionChainId, revision.revisionChainId))
    .limit(1);
  if (!approval) {
    throw MailServiceError.forbidden("Outbound revision attachment access denied");
  }
}

export async function resolveDownloadableOutboundRevisionAttachment(
  db: Database,
  actor: MailActorContext,
  revisionId: string,
  attachmentId: string,
): Promise<DownloadableOutboundRevisionAttachment> {
  const [attachment] = await db
    .select()
    .from(schema.mailOutboundRevisionAttachments)
    .where(
      and(
        eq(schema.mailOutboundRevisionAttachments.id, attachmentId),
        eq(schema.mailOutboundRevisionAttachments.revisionId, revisionId),
      ),
    )
    .limit(1);

  if (!attachment) {
    throw MailServiceError.notFound();
  }

  const [revision] = await db
    .select({
      id: schema.mailOutboundRevisions.id,
      revisionChainId: schema.mailOutboundRevisions.revisionChainId,
      createdByUserId: schema.mailOutboundRevisions.createdByUserId,
    })
    .from(schema.mailOutboundRevisions)
    .where(eq(schema.mailOutboundRevisions.id, revisionId))
    .limit(1);

  if (!revision) {
    throw MailServiceError.notFound();
  }

  await assertOutboundRevisionAttachmentReadAccess(db, actor, revision);

  const [storedFile] = await db
    .select()
    .from(schema.mailStoredFiles)
    .where(eq(schema.mailStoredFiles.id, attachment.storedFileId))
    .limit(1);

  assertStoredFileRelationshipIntegrity(attachment, storedFile);
  assertAttachmentDownloadEligibility({
    deliveryMode: attachment.deliveryMode,
    securityScanStatus: storedFile.securityScanStatus,
  });

  return {
    attachmentId: attachment.id,
    revisionId: revision.id,
    filename: resolveMailAttachmentDownloadFilename({
      displayFilename: attachment.displayFilename,
      originalFilename: attachment.originalFilename,
    }),
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    storageKey: storedFile.storageKey,
  };
}
