import { randomUUID } from "node:crypto";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import type { InboundRawPayloadBucket } from "@/lib/mail/inbound-raw-payload-store";
import { MAIL_STORAGE_PROVIDERS } from "../../../drizzle/schema/mail-stored-files";

/** Private outbound compose attachment object namespace — server-generated keys only. */
export const OUTBOUND_ATTACHMENT_KEY_PREFIX =
  "mail/outbound-attachments/" as const;

export type OutboundAttachmentPutResult = {
  storedFileId: string;
  contentHash: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: (typeof MAIL_STORAGE_PROVIDERS)[number];
  storageBucket: string;
  storageKey: string;
};

export interface OutboundAttachmentStore {
  put(input: {
    bytes: Uint8Array;
    originalFilename: string;
    mimeType: string;
  }): Promise<OutboundAttachmentPutResult>;
}

function assertOutboundAttachmentKey(storageKey: string): void {
  if (!storageKey.startsWith(OUTBOUND_ATTACHMENT_KEY_PREFIX)) {
    throw new Error("Invalid outbound attachment storage key namespace");
  }
}

function generateOutboundAttachmentStorageKey(): string {
  return `${OUTBOUND_ATTACHMENT_KEY_PREFIX}${randomUUID()}`;
}

export class MemoryOutboundAttachmentStore implements OutboundAttachmentStore {
  private readonly objects = new Map<string, Uint8Array>();

  async put(input: {
    bytes: Uint8Array;
    originalFilename: string;
    mimeType: string;
  }): Promise<OutboundAttachmentPutResult> {
    const storageKey = generateOutboundAttachmentStorageKey();
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
    assertOutboundAttachmentKey(storageKey);
    return this.objects.get(storageKey);
  }
}

export class R2OutboundAttachmentStore implements OutboundAttachmentStore {
  constructor(
    private readonly bucket: InboundRawPayloadBucket,
    private readonly storageBucket: string,
  ) {}

  async put(input: {
    bytes: Uint8Array;
    originalFilename: string;
    mimeType: string;
  }): Promise<OutboundAttachmentPutResult> {
    const storageKey = generateOutboundAttachmentStorageKey();
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

export function createOutboundAttachmentStore(
  bucket: InboundRawPayloadBucket | null | undefined,
  storageBucket: string,
): OutboundAttachmentStore {
  if (!bucket) {
    throw new Error(
      "ATTACHMENTS R2 binding is required for outbound attachment storage",
    );
  }
  return new R2OutboundAttachmentStore(bucket, storageBucket);
}
