import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractKnowledgeText,
  KNOWLEDGE_SOURCE_FILE_MAX_BYTES,
  normalizeKnowledgeFilename,
  validateKnowledgeFileMetadata,
  validateKnowledgePasteText,
} from "@/lib/knowledge/source-service";
import {
  createMemoryKnowledgeSourceStorage,
  createKnowledgeSourceStorageKey,
  KNOWLEDGE_SOURCE_KEY_PREFIX,
} from "@/lib/knowledge/source-storage";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";

function assertCode(action: () => unknown, code: string) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof KnowledgeServiceError);
    assert.equal(error.errorCode, code);
    return true;
  });
}

describe("Knowledge Package 3 source validation", () => {
  it("accepts meaningful paste text and rejects empty or oversized text", () => {
    assert.deepEqual(
      validateKnowledgePasteText({
        sourceTitle: "合成测试来源",
        rawText: "仅用于系统测试的内部流程文字。",
      }),
      {
        sourceTitle: "合成测试来源",
        rawText: "仅用于系统测试的内部流程文字。",
      },
    );
    assertCode(
      () => validateKnowledgePasteText({ rawText: "  " }),
      "KNOWLEDGE_SOURCE_INVALID",
    );
    assertCode(
      () =>
        validateKnowledgePasteText({
          rawText: "x".repeat(100_001),
        }),
      "KNOWLEDGE_SOURCE_INVALID",
    );
  });

  it("accepts TXT and Markdown metadata, and enforces size, MIME, and unsafe filename rules", () => {
    assert.equal(
      validateKnowledgeFileMetadata({
        filename: "流程.md",
        mimeType: "text/markdown",
        sizeBytes: 20,
      }).extension,
      ".md",
    );
    assert.equal(
      validateKnowledgeFileMetadata({
        filename: "流程.txt",
        mimeType: "text/plain",
        sizeBytes: 20,
      }).extension,
      ".txt",
    );
    assertCode(
      () =>
        validateKnowledgeFileMetadata({
          filename: "payload.exe",
          mimeType: "application/octet-stream",
          sizeBytes: 20,
        }),
      "UNSUPPORTED_FILE_TYPE",
    );
    assertCode(
      () =>
        validateKnowledgeFileMetadata({
          filename: "archive.zip",
          mimeType: "application/zip",
          sizeBytes: 20,
        }),
      "UNSUPPORTED_FILE_TYPE",
    );
    assertCode(
      () =>
        validateKnowledgeFileMetadata({
          filename: "流程.md",
          mimeType: "application/pdf",
          sizeBytes: 20,
        }),
      "MIME_MISMATCH",
    );
    assertCode(
      () =>
        validateKnowledgeFileMetadata({
          filename: "../unsafe.md",
          mimeType: "text/markdown",
          sizeBytes: 20,
        }),
      "UNSAFE_FILENAME",
    );
    assertCode(
      () =>
        validateKnowledgeFileMetadata({
          filename: "large.txt",
          mimeType: "text/plain",
          sizeBytes: KNOWLEDGE_SOURCE_FILE_MAX_BYTES + 1,
        }),
      "FILE_TOO_LARGE",
    );
  });

  it("extracts UTF-8 TXT/Markdown and safely refuses PDF/DOCX without a parser", () => {
    const bytes = new TextEncoder().encode("# 流程\n仅用于测试。").buffer;
    assert.equal(extractKnowledgeText(bytes, ".md").status, "ready");
    assertCode(
      () => extractKnowledgeText(new ArrayBuffer(4), ".pdf"),
      "TEXT_EXTRACTION_UNAVAILABLE",
    );
    assertCode(
      () => extractKnowledgeText(new ArrayBuffer(4), ".docx"),
      "TEXT_EXTRACTION_UNAVAILABLE",
    );
  });
});

describe("Knowledge Package 3 private source storage", () => {
  it("uses opaque Knowledge-only keys and never creates a public URL", async () => {
    const storage = createMemoryKnowledgeSourceStorage();
    const key = createKnowledgeSourceStorageKey();
    assert.ok(key.startsWith(KNOWLEDGE_SOURCE_KEY_PREFIX));
    assert.doesNotMatch(key, /@|\.md|\.txt|customer|email/i);
    const bytes = new TextEncoder().encode("synthetic source").buffer;
    await storage.put(key, bytes, {
      contentType: "text/plain",
      sourceId: "source-1",
    });
    assert.deepEqual(
      new Uint8Array((await storage.get(key)) ?? new ArrayBuffer(0)),
      new Uint8Array(bytes),
    );
    await storage.delete(key);
    assert.equal(await storage.get(key), null);
  });

  it("rejects path-like or control-character filenames", () => {
    assertCode(
      () => normalizeKnowledgeFilename("folder/file.txt"),
      "UNSAFE_FILENAME",
    );
    assertCode(
      () => normalizeKnowledgeFilename("bad\nname.txt"),
      "UNSAFE_FILENAME",
    );
  });
});
