import { getCloudflareContext } from "@opennextjs/cloudflare";

export const KNOWLEDGE_SOURCE_BUCKET_NAME = "crm-knowledge-sources" as const;
export const KNOWLEDGE_SOURCE_KEY_PREFIX = "knowledge/sources/" as const;

export type KnowledgeSourceStorage = {
  put(
    key: string,
    value: ArrayBuffer,
    metadata: { contentType: string; sourceId: string },
  ): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  delete(key: string): Promise<void>;
};

function assertOpaqueKey(key: string): void {
  if (
    !key.startsWith(KNOWLEDGE_SOURCE_KEY_PREFIX) ||
    key.includes("/") === false ||
    /[@\s]/.test(key) ||
    key.includes("..")
  ) {
    throw new Error("Invalid Knowledge source storage key");
  }
}

const r2Storage: KnowledgeSourceStorage = {
  async put(key, value, metadata) {
    assertOpaqueKey(key);
    const { env } = getCloudflareContext();
    const bucket = (env as CloudflareEnv).KNOWLEDGE_SOURCES;
    if (!bucket) {
      throw new Error("Knowledge source storage is not configured");
    }
    await bucket.put(key, value, {
      httpMetadata: { contentType: metadata.contentType },
      customMetadata: { sourceId: metadata.sourceId },
    });
  },

  async get(key) {
    assertOpaqueKey(key);
    const { env } = getCloudflareContext();
    const bucket = (env as CloudflareEnv).KNOWLEDGE_SOURCES;
    if (!bucket) {
      throw new Error("Knowledge source storage is not configured");
    }
    const object = await bucket.get(key);
    return object ? object.arrayBuffer() : null;
  },

  async delete(key) {
    assertOpaqueKey(key);
    const { env } = getCloudflareContext();
    const bucket = (env as CloudflareEnv).KNOWLEDGE_SOURCES;
    if (!bucket) {
      throw new Error("Knowledge source storage is not configured");
    }
    await bucket.delete(key);
  },
};

let localPreviewStorage: KnowledgeSourceStorage | null = null;

export function getKnowledgeSourceStorage(): KnowledgeSourceStorage {
  try {
    const { env } = getCloudflareContext();
    if ((env as CloudflareEnv).KNOWLEDGE_SOURCES) {
      return r2Storage;
    }
  } catch {
    // Local Next tests and development may not have a Cloudflare context.
  }
  if (process.env.NODE_ENV !== "production") {
    localPreviewStorage ??= createMemoryKnowledgeSourceStorage();
    return localPreviewStorage;
  }
  return r2Storage;
}

export function createMemoryKnowledgeSourceStorage(): KnowledgeSourceStorage {
  const objects = new Map<string, ArrayBuffer>();
  return {
    async put(key, value) {
      assertOpaqueKey(key);
      objects.set(key, value.slice(0));
    },
    async get(key) {
      assertOpaqueKey(key);
      const value = objects.get(key);
      return value ? value.slice(0) : null;
    },
    async delete(key) {
      assertOpaqueKey(key);
      objects.delete(key);
    },
  };
}

export function createKnowledgeSourceStorageKey(): string {
  return `${KNOWLEDGE_SOURCE_KEY_PREFIX}${crypto.randomUUID()}`;
}
