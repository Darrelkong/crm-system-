import assert from "node:assert/strict";
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
  archiveKnowledgeSource,
  createKnowledgeFileSource,
  createKnowledgePasteSource,
  getKnowledgeSource,
  restoreKnowledgeSource,
} from "@/lib/knowledge/source-service";
import { isFailedVisionImageDuplicate } from "@/lib/knowledge/source-duplicate";
import {
  createMemoryKnowledgeSourceStorage,
  type KnowledgeSourceStorage,
} from "@/lib/knowledge/source-storage";
import {
  buildScannedPdfBytes,
  buildTestDocxBytes,
  buildTestTextPdfBytes,
} from "@/lib/knowledge/test-fixtures/source-documents";
import { buildTestPngBytes } from "@/lib/knowledge/test-fixtures/source-images";

const META = { ipAddress: null, userAgent: "knowledge-duplicate-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;
let storage: KnowledgeSourceStorage;
let storagePutCount = 0;
let storageDeleteCount = 0;

const contributorContext = () => ({
  user: staffUser,
  sessionId: "duplicate-staff-session",
  role: "contributor" as const,
});

async function cleanup() {
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db.delete(schema.knowledgeSources);
  await db.delete(schema.auditLogs).where(like(schema.auditLogs.action, "knowledge_%"));
}

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

describe("Knowledge source exact duplicate detection", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    adminUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.admin)).limit(1)
    )[0] as User;
    staffUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)).limit(1)
    )[0] as User;
    storage = createMemoryKnowledgeSourceStorage();
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  beforeEach(async () => {
    await cleanup();
    storagePutCount = 0;
    storageDeleteCount = 0;
    storage = createInstrumentedStorage();
  });

  it("blocks identical DOCX uploads without creating a second source or R2 object", async () => {
    const bytes = await buildTestDocxBytes({ paragraphs: ["Duplicate DOCX body"] });
    const first = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(bytes, "first.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      META,
      db,
      storage,
    );
    assert.equal(first.status, "ready");
    const key = first.storageKey!;
    await assert.rejects(
      () =>
        createKnowledgeFileSource(
          contributorContext(),
          fileFrom(bytes, "second.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
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
    const rows = await db.select().from(schema.knowledgeSources);
    assert.equal(rows.length, 1);
    assert.equal(await storage.get(key) != null, true);
    assert.equal(storagePutCount, 1);
    assert.equal(storageDeleteCount, 0);
  });

  it("blocks identical PDF uploads and different filenames with the same binary", async () => {
    const bytes = buildTestTextPdfBytes(["Shared PDF text"]);
    await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(bytes, "alpha.pdf", "application/pdf"),
      META,
      db,
      storage,
    );
    await assert.rejects(
      () =>
        createKnowledgeFileSource(
          contributorContext(),
          fileFrom(bytes, "beta.pdf", "application/pdf"),
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
    assert.equal((await db.select().from(schema.knowledgeSources)).length, 1);
    assert.equal(storagePutCount, 1);
    assert.equal(storageDeleteCount, 0);
  });

  it("blocks duplicate paste and whitespace-only differences", async () => {
    await createKnowledgePasteSource(
      contributorContext(),
      { rawText: "Same paste body\n\nLine two" },
      META,
      db,
    );
    await assert.rejects(
      () =>
        createKnowledgePasteSource(
          contributorContext(),
          { rawText: "Same paste body\r\n\r\nLine two  \r\n" },
          META,
          db,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.SOURCE_DUPLICATE);
        return true;
      },
    );
    assert.equal((await db.select().from(schema.knowledgeSources)).length, 1);
  });

  it("blocks different binaries that extract to the same normalized text", async () => {
    const sharedText = "Shared extracted body";
    await createKnowledgePasteSource(
      contributorContext(),
      { rawText: sharedText },
      META,
      db,
    );
    const docx = await buildTestDocxBytes({ paragraphs: [sharedText] });
    await assert.rejects(
      () =>
        createKnowledgeFileSource(
          contributorContext(),
          fileFrom(
            docx,
            "same-text.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ),
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
    assert.equal((await db.select().from(schema.knowledgeSources)).length, 1);
    assert.equal(storagePutCount, 0);
    assert.equal(storageDeleteCount, 0);
  });

  it("reports archived duplicates and still blocks re-upload after archive", async () => {
    const bytes = await buildTestDocxBytes({ paragraphs: ["Archived duplicate body"] });
    const source = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(bytes, "archive-me.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      META,
      db,
      storage,
    );
    const archived = await archiveKnowledgeSource(
      contributorContext(),
      source.id,
      source.updatedAt,
      META,
      db,
    );
    assert.ok(archived.archivedAt);
    await assert.rejects(
      () =>
        createKnowledgeFileSource(
          contributorContext(),
          fileFrom(bytes, "archive-me-copy.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
          META,
          db,
          storage,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.SOURCE_DUPLICATE);
        const duplicate = error.details?.duplicate as { lifecycle?: string };
        assert.equal(duplicate.lifecycle, "archived");
        return true;
      },
    );
    const restored = await restoreKnowledgeSource(
      contributorContext(),
      source.id,
      archived.updatedAt,
      META,
      db,
    );
    assert.equal(restored.id, source.id);
    assert.equal(restored.archivedAt, null);
    assert.equal(storagePutCount, 1);
    assert.equal(storageDeleteCount, 0);
  });

  it("preserves R2 for extraction failures without delete rollback", async () => {
    const bytes = buildScannedPdfBytes();
    await assert.rejects(
      () =>
        createKnowledgeFileSource(
          contributorContext(),
          fileFrom(bytes, "scan.pdf", "application/pdf"),
          META,
          db,
          storage,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.SCANNED_PDF_UNSUPPORTED);
        return true;
      },
    );
    const failed = (await db.select().from(schema.knowledgeSources))[0];
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.failureCode, KNOWLEDGE_ERROR_CODES.SCANNED_PDF_UNSUPPORTED);
    assert.ok(failed?.storageKey);
    assert.ok(await storage.get(failed!.storageKey!));
    assert.equal(storagePutCount, 1);
    assert.equal(storageDeleteCount, 0);
  });

  it("stores exactly one source and one R2 object for a new valid DOCX", async () => {
    const bytes = await buildTestDocxBytes({ paragraphs: ["Valid unique DOCX body"] });
    const source = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(
        bytes,
        "unique.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      META,
      db,
      storage,
    );
    assert.equal(source.status, "ready");
    assert.equal((await db.select().from(schema.knowledgeSources)).length, 1);
    assert.equal(storagePutCount, 1);
    assert.equal(storageDeleteCount, 0);
  });

  it("reports failed vision image duplicates without active-source wording", async () => {
    process.env.CRM_ALLOW_MOCK_AI = "1";
    const bytes = buildTestPngBytes();
    const first = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(bytes, "p2c-b1-table.png", "image/png"),
      META,
      db,
      storage,
    );
    await db
      .update(schema.knowledgeSources)
      .set({
        status: "failed",
        failureCode: KNOWLEDGE_ERROR_CODES.VISION_OUTPUT_INVALID,
        rawText: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.knowledgeSources.id, first.id));
    storagePutCount = 0;
    await assert.rejects(
      () =>
        createKnowledgeFileSource(
          contributorContext(),
          fileFrom(bytes.slice(0), "p2c-b1-table.png", "image/png"),
          META,
          db,
          storage,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.SOURCE_DUPLICATE);
        const duplicate = error.details?.duplicate as {
          id: string;
          status: string;
        };
        assert.equal(duplicate.id, first.id);
        assert.equal(duplicate.status, "failed");
        assert.equal(
          isFailedVisionImageDuplicate(
            error.details?.duplicate as Parameters<
              typeof isFailedVisionImageDuplicate
            >[0],
          ),
          true,
        );
        assert.match(error.message, /讀取失敗/);
        assert.doesNotMatch(error.message, /有效来源/);
        return true;
      },
    );
    assert.equal((await db.select().from(schema.knowledgeSources)).length, 1);
    assert.equal(storagePutCount, 0);
  });

  it("writes duplicate-blocked audit metadata without raw text", async () => {
    const bytes = await buildTestDocxBytes({ paragraphs: ["Audit duplicate body"] });
    const first = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(bytes, "audit.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      META,
      db,
      storage,
    );
    try {
      await createKnowledgeFileSource(
        contributorContext(),
        fileFrom(bytes, "audit-copy.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        META,
        db,
        storage,
      );
    } catch {
      // expected
    }
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "knowledge_source_duplicate_blocked"));
    assert.equal(audits.length, 1);
    assert.ok(audits[0]?.metadata);
    assert.match(audits[0]!.metadata!, /audit-copy\.docx/);
    assert.doesNotMatch(audits[0]!.metadata!, /Audit duplicate body/);
    const existing = await getKnowledgeSource(contributorContext(), first.id, db);
    assert.equal(existing.status, "ready");
  });
});
