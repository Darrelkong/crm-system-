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
import {
  createMemoryKnowledgeSourceStorage,
  type KnowledgeSourceStorage,
} from "@/lib/knowledge/source-storage";
import { buildTestDocxBytes, buildTestTextPdfBytes } from "@/lib/knowledge/test-fixtures/source-documents";

const META = { ipAddress: null, userAgent: "knowledge-duplicate-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;
let storage: KnowledgeSourceStorage;

const contributorContext = () => ({
  user: staffUser,
  sessionId: "duplicate-staff-session",
  role: "contributor" as const,
});

const adminContext = () => ({
  user: adminUser,
  sessionId: "duplicate-admin-session",
  role: "knowledge_admin" as const,
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
    arrayBuffer: async () => bytes,
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
    storage = createMemoryKnowledgeSourceStorage();
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
