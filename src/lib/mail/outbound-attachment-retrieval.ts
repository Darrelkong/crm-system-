import { eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { NormalizedOutboundAttachment } from "@/lib/mail/transport/mail-transport-adapter";
import type { InboundRawPayloadBucket } from "@/lib/mail/inbound-raw-payload-store";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import { MailServiceError } from "@/lib/mail/errors";

/** Storage reference for an outbound attachment — bytes loaded separately. */
export type OutboundAttachmentStreamRef = {
  revisionAttachmentId: string;
  storedFileId: string;
  contentHash: string;
  displayFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  storageBucket: string;
  storageKey: string;
};

export async function resolveOutboundAttachmentStreamRefs(
  db: Database,
  attachments: NormalizedOutboundAttachment[],
): Promise<OutboundAttachmentStreamRef[]> {
  if (attachments.length === 0) {
    return [];
  }

  const fileIds = attachments.map((attachment) => attachment.storedFileId);
  const storedFiles = await db
    .select()
    .from(schema.mailStoredFiles)
    .where(inArray(schema.mailStoredFiles.id, fileIds));

  const byId = new Map(storedFiles.map((file) => [file.id, file]));
  const refs: OutboundAttachmentStreamRef[] = [];

  for (const attachment of attachments) {
    const stored = byId.get(attachment.storedFileId);
    if (!stored) {
      throw MailServiceError.notFound(
        `Stored file not found for attachment ${attachment.revisionAttachmentId}`,
      );
    }
    if (stored.contentHash !== attachment.contentHash) {
      throw MailServiceError.integrityConflict(
        "Attachment content hash mismatch against stored file",
      );
    }
    refs.push({
      revisionAttachmentId: attachment.revisionAttachmentId,
      storedFileId: stored.id,
      contentHash: stored.contentHash,
      displayFilename: attachment.displayFilename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      storageProvider: stored.storageProvider,
      storageBucket: stored.storageBucket,
      storageKey: stored.storageKey,
    });
  }

  return refs.sort(
    (left, right) =>
      attachments.findIndex(
        (item) => item.revisionAttachmentId === left.revisionAttachmentId,
      ) -
      attachments.findIndex(
        (item) => item.revisionAttachmentId === right.revisionAttachmentId,
      ),
  );
}

export interface OutboundAttachmentByteReader {
  read(ref: OutboundAttachmentStreamRef): Promise<Uint8Array>;
}

export class R2OutboundAttachmentByteReader implements OutboundAttachmentByteReader {
  constructor(private readonly bucket: InboundRawPayloadBucket) {}

  async read(ref: OutboundAttachmentStreamRef): Promise<Uint8Array> {
    const object = await this.bucket.get(ref.storageKey);
    if (!object) {
      throw MailServiceError.notFound(
        `Attachment object missing at storage key ${ref.storageKey}`,
      );
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    const hash = computeInboundPayloadContentHash(bytes);
    if (hash !== ref.contentHash) {
      throw MailServiceError.integrityConflict(
        "Attachment byte hash mismatch at read time",
      );
    }
    return bytes;
  }
}

export class MemoryOutboundAttachmentByteReader implements OutboundAttachmentByteReader {
  constructor(private readonly objects: Map<string, Uint8Array>) {}

  async read(ref: OutboundAttachmentStreamRef): Promise<Uint8Array> {
    const bytes = this.objects.get(ref.storageKey);
    if (!bytes) {
      throw MailServiceError.notFound(
        `Attachment object missing at storage key ${ref.storageKey}`,
      );
    }
    return new Uint8Array(bytes);
  }
}
