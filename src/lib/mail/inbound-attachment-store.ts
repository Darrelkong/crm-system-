import { randomUUID } from "node:crypto";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import type { InboundRawPayloadBucket } from "@/lib/mail/inbound-raw-payload-store";
import { MAIL_STORAGE_PROVIDERS } from "../../../drizzle/schema/mail-stored-files";

/** Private inbound attachment object namespace — server-generated keys only. */
export const INBOUND_ATTACHMENT_KEY_PREFIX = "mail/inbound-attachments/" as const;

export type InboundAttachmentPutResult = {
  storedFileId: string;
  contentHash: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: (typeof MAIL_STORAGE_PROVIDERS)[number];
  storageBucket: string;
  storageKey: string;
};

export interface InboundAttachmentStore {
  put(input: {
    bytes: Uint8Array;
    originalFilename: string;
    mimeType: string;
  }): Promise<InboundAttachmentPutResult>;
}

function assertInboundAttachmentKey(storageKey: string): void {
  if (!storageKey.startsWith(INBOUND_ATTACHMENT_KEY_PREFIX)) {
    throw new Error("Invalid inbound attachment storage key namespace");
  }
}

function generateInboundAttachmentStorageKey(): string {
  return `${INBOUND_ATTACHMENT_KEY_PREFIX}${randomUUID()}`;
}

export class MemoryInboundAttachmentStore implements InboundAttachmentStore {
  private readonly objects = new Map<string, Uint8Array>();

  async put(input: {
    bytes: Uint8Array;
    originalFilename: string;
    mimeType: string;
  }): Promise<InboundAttachmentPutResult> {
    const storageKey = generateInboundAttachmentStorageKey();
    this.objects.set(storageKey, new Uint8Array(input.bytes));
    const contentHash = computeInboundPayloadContentHash(input.bytes);
    return {
      storedFileId: randomUUID(),
      contentHash,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      storageProvider: "r2",
      storageBucket: "memory",
      storageKey,
    };
  }

  getObject(storageKey: string): Uint8Array | undefined {
    assertInboundAttachmentKey(storageKey);
    return this.objects.get(storageKey);
  }
}

export class R2InboundAttachmentStore implements InboundAttachmentStore {
  constructor(
    private readonly bucket: InboundRawPayloadBucket,
    private readonly storageBucket: string,
  ) {}

  async put(input: {
    bytes: Uint8Array;
    originalFilename: string;
    mimeType: string;
  }): Promise<InboundAttachmentPutResult> {
    const storageKey = generateInboundAttachmentStorageKey();
    await this.bucket.put(storageKey, input.bytes, {
      httpMetadata: { contentType: input.mimeType },
    });
    const contentHash = computeInboundPayloadContentHash(input.bytes);
    return {
      storedFileId: randomUUID(),
      contentHash,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      storageProvider: "r2",
      storageBucket: this.storageBucket,
      storageKey,
    };
  }
}

export function createInboundAttachmentStore(
  bucket: InboundRawPayloadBucket | null | undefined,
  storageBucket: string,
): InboundAttachmentStore {
  if (!bucket) {
    throw new Error("ATTACHMENTS R2 binding is required for inbound attachment storage");
  }
  return new R2InboundAttachmentStore(bucket, storageBucket);
}
