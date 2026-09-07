import { eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import { MailServiceError } from "@/lib/mail/errors";

const SEND_ELIGIBLE_SCAN_STATUS = "clean" as const;

/**
 * Operational stored-file safety at Send/dispatch time.
 * Canonical Content Hash v1 is unchanged — this is separate eligibility.
 */
export async function assertStoredFilesEligibleForSend(
  db: Database,
  revisionId: string,
  options: { allowUnscannedLargeAttachments?: boolean } = {},
): Promise<void> {
  const [revision] = await db
    .select({
      signatureSnapshotId: schema.mailOutboundRevisions.signatureSnapshotId,
    })
    .from(schema.mailOutboundRevisions)
    .where(eq(schema.mailOutboundRevisions.id, revisionId))
    .limit(1);

  if (!revision) {
    throw MailServiceError.notFound("Outbound revision not found");
  }

  const attachmentRows = await db
    .select({
      storedFileId: schema.mailOutboundRevisionAttachments.storedFileId,
      deliveryMode: schema.mailOutboundRevisionAttachments.deliveryMode,
    })
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, revisionId));

  const snapshotAssetRows = await db
    .select({ storedFileId: schema.mailSignatureSnapshotAssets.storedFileId })
    .from(schema.mailSignatureSnapshotAssets)
    .where(
      eq(
        schema.mailSignatureSnapshotAssets.signatureSnapshotId,
        revision.signatureSnapshotId,
      ),
    );

  const storedFileIds = [
    ...new Set([
      ...attachmentRows.map((row) => row.storedFileId),
      ...snapshotAssetRows.map((row) => row.storedFileId),
    ]),
  ];

  if (storedFileIds.length === 0) {
    return;
  }

  const storedFiles = await db
    .select({
      id: schema.mailStoredFiles.id,
      securityScanStatus: schema.mailStoredFiles.securityScanStatus,
    })
    .from(schema.mailStoredFiles)
    .where(inArray(schema.mailStoredFiles.id, storedFileIds));

  const byId = new Map(storedFiles.map((file) => [file.id, file]));
  const attachmentModeByStoredFileId = new Map(
    attachmentRows.map((row) => [row.storedFileId, row.deliveryMode]),
  );

  for (const fileId of storedFileIds) {
    const file = byId.get(fileId);
    if (!file) {
      throw MailServiceError.forbidden(
        "Referenced stored file is missing — send blocked",
      );
    }
    const allowUnscannedLarge =
      options.allowUnscannedLargeAttachments === true &&
      attachmentModeByStoredFileId.get(fileId) === "large_attachment" &&
      file.securityScanStatus === "unscanned";
    if (
      file.securityScanStatus !== SEND_ELIGIBLE_SCAN_STATUS &&
      !allowUnscannedLarge
    ) {
      throw MailServiceError.forbidden(
        `Stored file ${fileId} is not send-eligible (scan status: ${file.securityScanStatus})`,
      );
    }
  }
}
