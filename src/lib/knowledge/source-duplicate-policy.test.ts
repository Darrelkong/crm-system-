import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
  TURKEY_HK_INCORPORATION_FIXTURE_TEXT,
} from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  sourceBlocksOrganizeForVisionReview,
  visionExtractionReviewConfirmed,
} from "@/lib/knowledge/knowledge-vision-integrity";
import {
  assertNoBinaryFileDuplicate,
  assertNoPasteTextDuplicate,
  GENERIC_VISION_EXTRACTION_PLACEHOLDER,
  isGenericExtractionPlaceholderText,
} from "@/lib/knowledge/source-duplicate";
import {
  confirmKnowledgeVisionExtraction,
  createKnowledgeFileSource,
  createKnowledgePasteSource,
} from "@/lib/knowledge/source-service";
import {
  createMemoryKnowledgeSourceStorage,
  type KnowledgeSourceStorage,
} from "@/lib/knowledge/source-storage";
import { buildVisionExtractionMetadata } from "@/lib/knowledge/vision-extraction-metadata";
import { mockKnowledgeVisionExtract } from "@/lib/knowledge/vision-extraction-mock";
import {
  buildTestPngBytes,
  buildUniqueTestPngBytes,
} from "@/lib/knowledge/test-fixtures/source-images";
import { normalizeKnowledgeSourceText } from "@/lib/knowledge/source-text-normalization";

const META = { ipAddress: null, userAgent: "knowledge-duplicate-policy-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let staffUser: User;
let storage: KnowledgeSourceStorage;

const contributorContext = () => ({
  user: staffUser,
  sessionId: "duplicate-policy-staff-session",
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

function fileContentHash(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

async function cleanup() {
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db.delete(schema.knowledgeSources);
  await db.delete(schema.auditLogs).where(like(schema.auditLogs.action, "knowledge_%"));
}

describe("knowledge duplicate policy primitives", () => {
  it("detects generic extraction placeholder text", () => {
    assert.equal(
      isGenericExtractionPlaceholderText(GENERIC_VISION_EXTRACTION_PLACEHOLDER),
      true,
    );
    assert.equal(
      isGenericExtractionPlaceholderText("Chase Private Client\n大通私人银行账户"),
      false,
    );
  });

  it("mock turkey and chase fixtures are semantically distinct", () => {
    assert.match(TURKEY_HK_INCORPORATION_FIXTURE_TEXT, /土耳其/);
    assert.match(CHASE_PRIVATE_CLIENT_FIXTURE_TEXT, /Chase Private Client/);
    assert.doesNotMatch(CHASE_PRIVATE_CLIENT_FIXTURE_TEXT, /土耳其/);
    assert.doesNotMatch(TURKEY_HK_INCORPORATION_FIXTURE_TEXT, /Chase Private Client/);
  });

  it("mock default fallback text is unique per file bytes", () => {
    const first = mockKnowledgeVisionExtract({
      bytes: buildUniqueTestPngBytes(1),
      filename: "IMG_6819.jpeg",
    });
    const second = mockKnowledgeVisionExtract({
      bytes: buildUniqueTestPngBytes(2),
      filename: "IMG_6838.png",
    });
    assert.notEqual(normalizeKnowledgeSourceText(first.text), normalizeKnowledgeSourceText(second.text));
  });

  it("clear screenshot can require review without being unreadable", () => {
    const chase = mockKnowledgeVisionExtract({
      bytes: buildTestPngBytes(),
      filename: "chase-private-client-screenshot.png",
    });
    assert.match(chase.text, /Chase Private Client/);
    assert.match(chase.text, /Zelle/);
    const metadata = buildVisionExtractionMetadata({
      quality: chase.quality,
      warnings: chase.warnings,
    });
    assert.equal(
      sourceBlocksOrganizeForVisionReview({
        extractionMethod: "vision",
        extractionMetadata: metadata,
        rawText: chase.text,
      }),
      true,
    );
    assert.equal(visionExtractionReviewConfirmed(metadata), false);
  });
});

const d1HarnessReady = Boolean(
  process.env.CRM_TEST_D1_HTTP_URL && process.env.CRM_TEST_D1_HTTP_TOKEN,
);

describe("knowledge duplicate policy integration", () => {
  before(async () => {
    if (!d1HarnessReady) return;
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    process.env.CRM_ALLOW_MOCK_AI = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    staffUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)).limit(1)
    )[0] as User;
    storage = createMemoryKnowledgeSourceStorage();
    await cleanup();
  });

  after(async () => {
    if (!d1HarnessReady) return;
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  beforeEach(async () => {
    if (!d1HarnessReady) return;
    await cleanup();
    storage = createMemoryKnowledgeSourceStorage();
  });

  it("A: two different review-required images are not duplicates", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const turkey = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(buildUniqueTestPngBytes(11), "turkey-hk-incorporation.png", "image/png"),
      META,
      db,
      storage,
    );
    const chase = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(buildUniqueTestPngBytes(12), "IMG_6838.png", "image/png"),
      META,
      db,
      storage,
    );
    assert.equal(turkey.status, "ready");
    assert.equal(chase.status, "ready");
    assert.notEqual(turkey.id, chase.id);
    assert.notEqual(turkey.rawText, chase.rawText);
  });

  it("B: two different failed-extraction placeholder images are not duplicates", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(buildUniqueTestPngBytes(21), "unknown-a.png", "image/png"),
      META,
      db,
      storage,
    );
    const second = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(buildUniqueTestPngBytes(22), "unknown-b.png", "image/png"),
      META,
      db,
      storage,
    );
    assert.equal(second.status, "ready");
    assert.equal((await db.select().from(schema.knowledgeSources)).length, 2);
  });

  it("C: exact same file bytes are duplicate", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const bytes = buildUniqueTestPngBytes(31);
    await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(bytes, "first.png", "image/png"),
      META,
      db,
      storage,
    );
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
  });

  it("D: same filename with different bytes is not duplicate", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(buildUniqueTestPngBytes(41), "IMG_6838.png", "image/png"),
      META,
      db,
      storage,
    );
    const second = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(buildUniqueTestPngBytes(42), "IMG_6838.png", "image/png"),
      META,
      db,
      storage,
    );
    assert.equal(second.status, "ready");
  });

  it("E: different filename with same bytes is duplicate", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const bytes = buildUniqueTestPngBytes(51);
    await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(bytes, "IMG_6819.png", "image/png"),
      META,
      db,
      storage,
    );
    await assert.rejects(
      () =>
        createKnowledgeFileSource(
          contributorContext(),
          fileFrom(bytes.slice(0), "IMG_6838.png", "image/png"),
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
  });

  it("F: generic placeholder text does not create paste duplicate collision for files", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const placeholder = GENERIC_VISION_EXTRACTION_PLACEHOLDER;
    await createKnowledgePasteSource(
      contributorContext(),
      { sourceTitle: "placeholder paste", rawText: placeholder },
      META,
      db,
    );
    await assert.rejects(
      () =>
        createKnowledgePasteSource(
          contributorContext(),
          { sourceTitle: "placeholder paste 2", rawText: placeholder },
          META,
          db,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.SOURCE_DUPLICATE);
        return true;
      },
    );
    const file = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(buildUniqueTestPngBytes(61), "unmatched.png", "image/png"),
      META,
      db,
      storage,
    );
    assert.equal(file.status, "ready");
    assert.match(file.rawText ?? "", /fixture:/);
  });

  it("G: chase fixture is not duplicate of turkey fixture", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const turkey = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(buildUniqueTestPngBytes(71), "turkey-hk-incorporation.png", "image/png"),
      META,
      db,
      storage,
    );
    const chase = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(buildUniqueTestPngBytes(72), "chase-private-client-screenshot.png", "image/png"),
      META,
      db,
      storage,
    );
    assert.match(turkey.rawText ?? "", /土耳其/);
    assert.match(chase.rawText ?? "", /Chase Private Client/);
    assert.notEqual(fileContentHash(buildUniqueTestPngBytes(71)), fileContentHash(buildUniqueTestPngBytes(72)));
  });

  it("I: organizer remains blocked until vision review confirmation", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const source = await createKnowledgeFileSource(
      contributorContext(),
      fileFrom(buildUniqueTestPngBytes(81), "chase-private-client-screenshot.png", "image/png"),
      META,
      db,
      storage,
    );
    assert.equal(
      sourceBlocksOrganizeForVisionReview({
        extractionMethod: source.extractionMethod,
        extractionMetadata: source.extractionMetadata,
        rawText: source.rawText,
      }),
      true,
    );
    const confirmed = await confirmKnowledgeVisionExtraction(
      contributorContext(),
      source.id,
      { rawText: source.rawText },
      META,
      db,
    );
    assert.equal(
      sourceBlocksOrganizeForVisionReview({
        extractionMethod: confirmed.extractionMethod,
        extractionMetadata: confirmed.extractionMetadata,
        rawText: confirmed.rawText,
      }),
      false,
    );
  });

  it("J: pasted-text dedupe still works from raw user text", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const text = "用户粘贴的原始文字 A";
    await createKnowledgePasteSource(
      contributorContext(),
      { sourceTitle: "paste-a", rawText: text },
      META,
      db,
    );
    await assert.rejects(
      () =>
        createKnowledgePasteSource(
          contributorContext(),
          { sourceTitle: "paste-b", rawText: `  ${text}  ` },
          META,
          db,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.SOURCE_DUPLICATE);
        return true;
      },
    );
  });
});
