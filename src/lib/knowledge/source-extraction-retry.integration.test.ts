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
  retryKnowledgeSourceExtraction,
} from "@/lib/knowledge/source-service";
import {
  createKnowledgeSourceStorageKey,
  createMemoryKnowledgeSourceStorage,
  type KnowledgeSourceStorage,
} from "@/lib/knowledge/source-storage";
import { loadKnowledgePreviewIngestFixtureBytes } from "@/lib/knowledge/test-fixtures/source-images";

const META = { ipAddress: null, userAgent: "knowledge-extraction-retry-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let staffUser: User;
let reviewerUser: User;
let storage: KnowledgeSourceStorage;
let storagePutCount = 0;
let storageDeleteCount = 0;

const contributorContext = () => ({
  user: staffUser,
  sessionId: "retry-staff-session",
  role: "contributor" as const,
});

const reviewerContext = () => ({
  user: reviewerUser,
  sessionId: "retry-reviewer-session",
  role: "reviewer" as const,
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
      storageDeleteCount += 1;
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

async function setRole(userId: string, role: "contributor" | "reviewer") {
  const now = new Date().toISOString();
  await db
    .insert(schema.knowledgeUserRoles)
    .values({
      userId,
      role,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.knowledgeUserRoles.userId,
      set: { role, updatedAt: now },
    });
}

const d1HarnessReady = Boolean(
  process.env.CRM_TEST_D1_HTTP_URL && process.env.CRM_TEST_D1_HTTP_TOKEN,
);

describe("Knowledge vision extraction retry", () => {
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
    reviewerUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffB)).limit(1)
    )[0] as User;
    await setRole(staffUser.id, "contributor");
    await setRole(reviewerUser.id, "reviewer");
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
    storageDeleteCount = 0;
  });

  async function createFailedVisionSource(filename = "p2c-b1-table.png") {
    const bytes = loadKnowledgePreviewIngestFixtureBytes(filename);
    const source = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(bytes, filename, "image/png"),
      META,
      db,
      storage,
    );
    const storageKey = source.storageKey!;
    const sourceId = source.id;
    await db
      .update(schema.knowledgeSources)
      .set({
        status: "failed",
        failureCode: KNOWLEDGE_ERROR_CODES.VISION_OUTPUT_INVALID,
        rawText: null,
        extractionMethod: null,
        extractionModel: null,
        extractionMetadataJson: null,
        pageCount: null,
        processedAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.knowledgeSources.id, sourceId));
    storagePutCount = 0;
    return { sourceId, storageKey, bytes };
  }

  it("retries failed vision source in place without new R2 put or delete", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const { sourceId, storageKey } = await createFailedVisionSource();
    const retried = await retryKnowledgeSourceExtraction(
      contributorContext(),
      sourceId,
      META,
      db,
      storage,
    );
    assert.equal(retried.id, sourceId);
    assert.equal(retried.storageKey, storageKey);
    assert.equal(retried.status, "ready");
    assert.equal(retried.failureCode, null);
    assert.ok(retried.rawText);
    assert.equal(retried.extractionMethod, "vision");
    assert.equal(retried.extractionModel, "mock-knowledge-vision-v1");
    assert.ok(retried.extractionMetadata);
    assert.equal(retried.pageCount, 1);
    assert.equal(storagePutCount, 0);
    assert.equal(storageDeleteCount, 0);
    assert.equal((await db.select().from(schema.knowledgeSources)).length, 1);
    assert.ok(await storage.get(storageKey));
  });

  it("keeps failed status and original R2 when retry extraction fails", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const badBytes = new TextEncoder().encode("not-a-png").buffer;
    const sourceId = crypto.randomUUID();
    const storageKey = createKnowledgeSourceStorageKey();
    const now = new Date().toISOString();
    await storage.put(storageKey, badBytes, {
      contentType: "image/png",
      sourceId,
    });
    storagePutCount = 0;
    await db.insert(schema.knowledgeSources).values({
      id: sourceId,
      sourceType: "file",
      sourceTitle: null,
      originalFilename: "broken.png",
      mimeType: "image/png",
      sizeBytes: badBytes.byteLength,
      rawText: null,
      storageKey,
      contentHash: "deadbeef-broken-png",
      status: "failed",
      createdByUserId: staffUser.id,
      createdAt: now,
      updatedAt: now,
      processedAt: null,
      failureCode: KNOWLEDGE_ERROR_CODES.IMAGE_INVALID,
      linkedArticleId: null,
      analysisStatus: "none",
    });
    await assert.rejects(
      () =>
        retryKnowledgeSourceExtraction(
          contributorContext(),
          sourceId,
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
    const row = (
      await db
        .select()
        .from(schema.knowledgeSources)
        .where(eq(schema.knowledgeSources.id, sourceId))
        .limit(1)
    )[0];
    assert.equal(row?.status, "failed");
    assert.equal(storagePutCount, 0);
    assert.equal(storageDeleteCount, 0);
    assert.ok(await storage.get(storageKey));
  });

  it("denies reviewer retry and allows contributor owner", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const { sourceId } = await createFailedVisionSource();
    await assert.rejects(
      () =>
        retryKnowledgeSourceExtraction(
          reviewerContext(),
          sourceId,
          META,
          db,
          storage,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED);
        return true;
      },
    );
    const retried = await retryKnowledgeSourceExtraction(
      contributorContext(),
      sourceId,
      META,
      db,
      storage,
    );
    assert.equal(retried.status, "ready");
  });

  it("rejects concurrent retry with run conflict", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const { sourceId } = await createFailedVisionSource();
    const [first, second] = await Promise.allSettled([
      retryKnowledgeSourceExtraction(
        contributorContext(),
        sourceId,
        META,
        db,
        storage,
      ),
      retryKnowledgeSourceExtraction(
        contributorContext(),
        sourceId,
        META,
        db,
        storage,
      ),
    ]);
    const outcomes = [first, second];
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const conflict = rejected[0] as PromiseRejectedResult;
    assert.ok(conflict.reason instanceof KnowledgeServiceError);
    assert.equal(conflict.reason.errorCode, KNOWLEDGE_ERROR_CODES.AI_RUN_CONFLICT);
  });

  it("restores blurry fixture to ready with advisory metadata on retry", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const { sourceId } = await createFailedVisionSource("p2c-b1-blurry-uncertain.png");
    const retried = await retryKnowledgeSourceExtraction(
      contributorContext(),
      sourceId,
      META,
      db,
      storage,
    );
    assert.equal(retried.status, "ready");
    assert.equal(retried.extractionMetadata?.quality, "medium");
    const warningCodes = new Set(
      retried.extractionMetadata?.warnings.map((warning) => warning.code) ?? [],
    );
    assert.ok(warningCodes.has("BLURRY_IMAGE"));
    assert.ok(warningCodes.has("UNREADABLE_NUMBER"));
    assert.ok((retried.extractionMetadata?.warnings.length ?? 0) >= 2);
    const detail = await getKnowledgeSource(contributorContext(), sourceId, db);
    assert.equal(detail.id, sourceId);
  });
});
