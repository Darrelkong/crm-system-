import type { MailDeliveryMode } from "../../../../drizzle/schema/mail-draft-attachments";

/** Immutable revision attachment snapshot fields for large_attachment (no mutable URLs). */
export type LargeAttachmentRevisionSnapshotFields = {
  storedFileId: string;
  contentHash: string;
  deliveryMode: Extract<MailDeliveryMode, "large_attachment">;
  displayFilename: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  secureExpiryDays: null;
  lifecycleId: string | null;
  storageVersion: string;
  storageEtag: string;
};

export function buildLargeAttachmentRevisionSnapshotFields(input: {
  storedFileId: string;
  contentHash: string;
  displayFilename: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  lifecycleId?: string | null;
  storageVersion: string;
  storageEtag: string;
}): LargeAttachmentRevisionSnapshotFields {
  return {
    storedFileId: input.storedFileId,
    contentHash: input.contentHash,
    deliveryMode: "large_attachment",
    displayFilename: input.displayFilename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sortOrder: input.sortOrder,
    secureExpiryDays: null,
    lifecycleId: input.lifecycleId ?? null,
    storageVersion: input.storageVersion,
    storageEtag: input.storageEtag,
  };
}

export function assertRevisionSnapshotHasNoMutableDownloadUrl(
  snapshot: Record<string, unknown>,
): void {
  for (const forbidden of [
    "downloadUrl",
    "presignedUrl",
    "presignedPutUrl",
    "publicUrl",
    "signedUrl",
    "bearerToken",
  ]) {
    if (forbidden in snapshot) {
      throw new Error(`Revision snapshot must not contain mutable URL field: ${forbidden}`);
    }
  }
}
