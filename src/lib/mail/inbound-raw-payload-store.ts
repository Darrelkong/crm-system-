import { randomUUID } from "node:crypto";

/** Private raw-ingestion object namespace — NOT mail_stored_files. */
export const INBOUND_RAW_PAYLOAD_KEY_PREFIX = "mail/raw-ingestion/" as const;

/** Stored in mail_provider_ingestion_events.payload_storage_provider. */
export const INBOUND_RAW_PAYLOAD_STORAGE_PROVIDER = "r2" as const;

export type InboundRawPayloadPutResult = {
  storageProvider: typeof INBOUND_RAW_PAYLOAD_STORAGE_PROVIDER;
  storageKey: string;
};

export type InboundRawPayloadBucket = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
};

export type InboundRawPayloadDeleteOutcome = "deleted" | "already_missing";

export interface InboundRawPayloadStore {
  put(bytes: Uint8Array): Promise<InboundRawPayloadPutResult>;
  get(storageKey: string): Promise<Uint8Array | null>;
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string): Promise<InboundRawPayloadDeleteOutcome>;
}

export function isInboundRawPayloadStorageKey(storageKey: string): boolean {
  return storageKey.startsWith(INBOUND_RAW_PAYLOAD_KEY_PREFIX);
}

export function generateInboundRawPayloadStorageKey(): string {
  return `${INBOUND_RAW_PAYLOAD_KEY_PREFIX}${randomUUID()}`;
}

function assertInboundRawPayloadKey(storageKey: string): void {
  if (!isInboundRawPayloadStorageKey(storageKey)) {
    throw new Error("Invalid inbound raw payload storage key namespace");
  }
}

/** In-memory store for unit tests. */
export class MemoryInboundRawPayloadStore implements InboundRawPayloadStore {
  private readonly objects = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array): Promise<InboundRawPayloadPutResult> {
    const storageKey = generateInboundRawPayloadStorageKey();
    this.objects.set(storageKey, new Uint8Array(bytes));
    return {
      storageProvider: INBOUND_RAW_PAYLOAD_STORAGE_PROVIDER,
      storageKey,
    };
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    assertInboundRawPayloadKey(storageKey);
    const value = this.objects.get(storageKey);
    return value ? new Uint8Array(value) : null;
  }

  async exists(storageKey: string): Promise<boolean> {
    assertInboundRawPayloadKey(storageKey);
    return this.objects.has(storageKey);
  }

  async delete(storageKey: string): Promise<InboundRawPayloadDeleteOutcome> {
    assertInboundRawPayloadKey(storageKey);
    if (!this.objects.has(storageKey)) {
      return "already_missing";
    }
    this.objects.delete(storageKey);
    return "deleted";
  }

  /** Test-only: overwrite bytes at an existing storage key. */
  replaceForTest(storageKey: string, bytes: Uint8Array): void {
    assertInboundRawPayloadKey(storageKey);
    this.objects.set(storageKey, new Uint8Array(bytes));
  }
}

/** Local/production R2 binding — dedicated private prefix, no public URLs. */
export class R2InboundRawPayloadStore implements InboundRawPayloadStore {
  constructor(private readonly bucket: InboundRawPayloadBucket) {}

  async put(bytes: Uint8Array): Promise<InboundRawPayloadPutResult> {
    const storageKey = generateInboundRawPayloadStorageKey();
    await this.bucket.put(storageKey, bytes, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    return {
      storageProvider: INBOUND_RAW_PAYLOAD_STORAGE_PROVIDER,
      storageKey,
    };
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    assertInboundRawPayloadKey(storageKey);
    const object = await this.bucket.get(storageKey);
    if (!object) {
      return null;
    }
    const buffer = await object.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async exists(storageKey: string): Promise<boolean> {
    assertInboundRawPayloadKey(storageKey);
    const head = await this.bucket.head(storageKey);
    return head !== null;
  }

  async delete(storageKey: string): Promise<InboundRawPayloadDeleteOutcome> {
    assertInboundRawPayloadKey(storageKey);
    const head = await this.bucket.head(storageKey);
    if (head === null) {
      return "already_missing";
    }
    await this.bucket.delete(storageKey);
    return "deleted";
  }
}

/** Test double — fails all put operations. */
export class FailingInboundRawPayloadStore implements InboundRawPayloadStore {
  constructor(private readonly message = "Raw payload storage failed") {}

  async put(_bytes: Uint8Array): Promise<InboundRawPayloadPutResult> {
    throw new Error(this.message);
  }

  async get(_storageKey: string): Promise<Uint8Array | null> {
    return null;
  }

  async exists(_storageKey: string): Promise<boolean> {
    return false;
  }

  async delete(_storageKey: string): Promise<InboundRawPayloadDeleteOutcome> {
    throw new Error(this.message);
  }
}

export function createInboundRawPayloadStore(
  bucket: InboundRawPayloadBucket | null | undefined,
): InboundRawPayloadStore {
  if (!bucket) {
    throw new Error("ATTACHMENTS R2 binding is required for inbound raw payload storage");
  }
  return new R2InboundRawPayloadStore(bucket);
}
