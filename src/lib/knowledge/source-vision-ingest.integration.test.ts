import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  createKnowledgeFileSource,
  getKnowledgeSource,
} from "@/lib/knowledge/source-service";
import {
  createMemoryKnowledgeSourceStorage,
  type KnowledgeSourceStorage,
} from "@/lib/knowledge/source-storage";
import {
  buildTestPngBytes,
  buildUniqueTestPngBytes,
} from "@/lib/knowledge/test-fixtures/source-images";

const META = { ipAddress: null, userAgent: "knowledge-vision-ingest-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let staffUser: User;
let storage: KnowledgeSourceStorage;
let storagePutCount = 0;

const contributorContext = () => ({
  user: staffUser,
  sessionId: "vision-ingest-staff-session",
  role: "contributor" as const,
});

function fileFrom(bytes: ArrayBuffer, name: string, type: string) {
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice(0),
  };
}

function createInstrumentedStorage(): KnowledgeSourceStorage {
  const inner = createMemoryKnowledgeSourceStorage();
  return {
    async put(key, value, metadata) {
      storagePutCount += 1;
      await inner.put(key, value, metadata);
    },
    async get(key) {
      return inner.get(key);
    },
    async delete(key) {
      await inner.delete(key);
    },
  };
}

async function applyMigration0083() {
  const sql = readFileSync(
    join(process.cwd(), "drizzle/migrations/0083_knowledge_source_extraction_metadata.sql"),
    "utf8",
  );
  for (const statement of sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    try {
      await db.run(statement);
    } catch {
      // Column may already exist on shared test DB.
    }
  }
}

async function cleanup() {
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db.delete(schema.knowledgeSources);
  await db.delete(schema.auditLogs).where(like(schema.auditLogs.action, "knowledge_%"));
}

const d1HarnessReady = Boolean(
  process.env.CRM_TEST_D1_HTTP_URL && process.env.CRM_TEST_D1_HTTP_TOKEN,
);

describe("Knowledge vision image ingest integration", () => {
  before(async () => {
    if (!d1HarnessReady) {
      return;
    }
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    process.env.CRM_ALLOW_MOCK_AI = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    await applyMigration0083();
    staffUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)).limit(1)
    )[0] as User;
    storage = createInstrumentedStorage();
    await cleanup();
  });

  after(async () => {
    if (!d1HarnessReady) {
      return;
    }
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  beforeEach(async () => {
    if (!d1HarnessReady) {
      return;
    }
    await cleanup();
    storage = createInstrumentedStorage();
    storagePutCount = 0;
  });

  it("persists successful PNG vision extraction with metadata and R2 original", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const bytes = buildTestPngBytes();
    const source = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(bytes, "p2c-b1-clear-chinese.png", "image/png"),
      META,
      db,
      storage,
    );
    assert.equal(source.status, "ready");
    assert.equal(source.extractionMethod, "vision");
    assert.equal(source.pageCount, 1);
    assert.match(source.rawText ?? "", /50\s*万/);
    assert.ok(source.extractionMetadata);
    assert.equal(storagePutCount, 1);
    const stored = await getKnowledgeSource(contributorContext(), source.id, db);
    assert.ok(stored.storageKey);
    const object = await storage.get(stored.storageKey!);
    assert.ok(object);
  });

  it("blocks exact binary duplicate before R2 put and vision extraction", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const bytes = buildUniqueTestPngBytes(42);
    await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(bytes, "first.png", "image/png"),
      META,
      db,
      storage,
    );
    storagePutCount = 0;
    await assert.rejects(
      () =>
        createKnowledgeFileSource(
          contributorContext(),
          fileFrom(bytes.slice(0), "second.png", "image/png"),
          META,
          db,
          storage,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.SOURCE_DUPLICATE);
        return true;
      },
    );
    assert.equal(storagePutCount, 0);
  });

  it("retains original R2 object when vision extraction fails", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const badBytes = new TextEncoder().encode("not-a-png").buffer;
    await assert.rejects(
      () =>
        createKnowledgeFileSource(
          contributorContext(),
          fileFrom(badBytes, "broken.png", "image/png"),
          META,
          db,
          storage,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.IMAGE_INVALID);
        return true;
      },
    );
    const rows = await db.select().from(schema.knowledgeSources);
    const failed = rows.find((row) => row.originalFilename === "broken.png");
    assert.ok(failed);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.failureCode, KNOWLEDGE_ERROR_CODES.IMAGE_INVALID);
    assert.ok(failed?.storageKey);
    const object = await storage.get(failed!.storageKey!);
    assert.ok(object);
  });
});
