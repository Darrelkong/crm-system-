import type { InboundRawPayloadBucket } from "@/lib/mail/inbound-raw-payload-store";

export class MailAttachmentObjectNotFoundError extends Error {
  readonly code = "OBJECT_NOT_FOUND" as const;

  constructor(message = "Attachment object not found") {
    super(message);
    this.name = "MailAttachmentObjectNotFoundError";
  }
}

export class MailAttachmentByteIntegrityError extends Error {
  readonly code = "BYTE_INTEGRITY" as const;

  constructor(message = "Attachment byte integrity mismatch") {
    super(message);
    this.name = "MailAttachmentByteIntegrityError";
  }
}

export class MailAttachmentR2OperationalError extends Error {
  readonly code = "R2_OPERATIONAL_FAILURE" as const;

  constructor(message = "Attachment storage operation failed") {
    super(message);
    this.name = "MailAttachmentR2OperationalError";
  }
}

export interface MailAttachmentByteReader {
  read(
    storageKey: string,
    expectedSizeBytes: number,
  ): Promise<Uint8Array>;
}

export class R2MailAttachmentByteReader implements MailAttachmentByteReader {
  constructor(private readonly bucket: InboundRawPayloadBucket) {}

  async read(
    storageKey: string,
    expectedSizeBytes: number,
  ): Promise<Uint8Array> {
    try {
      const object = await this.bucket.get(storageKey);
      if (!object) {
        throw new MailAttachmentObjectNotFoundError();
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (bytes.byteLength !== expectedSizeBytes) {
        throw new MailAttachmentByteIntegrityError();
      }
      return bytes;
    } catch (error) {
      if (
        error instanceof MailAttachmentObjectNotFoundError ||
        error instanceof MailAttachmentByteIntegrityError
      ) {
        throw error;
      }
      throw new MailAttachmentR2OperationalError();
    }
  }
}

export class MemoryMailAttachmentByteReader implements MailAttachmentByteReader {
  constructor(private readonly objects: Map<string, Uint8Array>) {}

  async read(
    storageKey: string,
    expectedSizeBytes: number,
  ): Promise<Uint8Array> {
    const bytes = this.objects.get(storageKey);
    if (!bytes) {
      throw new MailAttachmentObjectNotFoundError();
    }
    if (bytes.byteLength !== expectedSizeBytes) {
      throw new MailAttachmentByteIntegrityError();
    }
    return new Uint8Array(bytes);
  }
}
