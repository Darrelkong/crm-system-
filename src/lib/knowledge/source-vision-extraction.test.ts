import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  assertKnowledgeImageMagicBytes,
  isKnowledgeImageExtension,
} from "@/lib/knowledge/source-image-validation";
import { extractKnowledgeSourceText } from "@/lib/knowledge/source-extraction";
import { validateKnowledgeFileMetadata } from "@/lib/knowledge/source-service";
import {
  buildTestJpegBytes,
  buildTestPngBytes,
} from "@/lib/knowledge/test-fixtures/source-images";
import { mockKnowledgeVisionExtract } from "@/lib/knowledge/vision-extraction-mock";
import {
  buildVisionExtractionMetadata,
  parseVisionExtractionMetadata,
  serializeVisionExtractionMetadata,
} from "@/lib/knowledge/vision-extraction-metadata";

describe("Knowledge image validation", () => {
  it("accepts jpg jpeg png extensions", () => {
    assert.equal(isKnowledgeImageExtension(".jpg"), true);
    assert.equal(isKnowledgeImageExtension(".jpeg"), true);
    assert.equal(isKnowledgeImageExtension(".png"), true);
    assert.equal(isKnowledgeImageExtension(".webp"), false);
  });

  it("rejects invalid magic bytes", () => {
    const bad = new TextEncoder().encode("not-an-image").buffer;
    assert.throws(
      () => assertKnowledgeImageMagicBytes(bad, ".png"),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.IMAGE_INVALID);
        return true;
      },
    );
  });

  it("rejects webp at upload validation", () => {
    assert.throws(
      () =>
        validateKnowledgeFileMetadata({
          filename: "photo.webp",
          mimeType: "image/webp",
          sizeBytes: 128,
        }),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.UNSUPPORTED_FILE_TYPE);
        return true;
      },
    );
  });

  it("rejects heic at upload validation", () => {
    assert.throws(
      () =>
        validateKnowledgeFileMetadata({
          filename: "photo.heic",
          mimeType: "image/heic",
          sizeBytes: 128,
        }),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.UNSUPPORTED_FILE_TYPE);
        return true;
      },
    );
  });
});

describe("Knowledge vision mock extraction", () => {
  before(() => {
    process.env.CRM_ALLOW_MOCK_AI = "1";
  });

  it("transcribes clear Chinese PNG with numeric preservation", async () => {
    const result = await extractKnowledgeSourceText({
      bytes: buildTestPngBytes(),
      filename: "p2c-b1-clear-chinese.png",
      mimeType: "image/png",
    });
    assert.match(result.text, /50\s*万/);
    assert.match(result.text, /4.?6\s*周/);
    assert.equal(result.extractionMethod, "vision");
    assert.equal(result.pageCount, 1);
    assert.ok(result.extractionMetadata);
  });

  it("preserves uncertain digits in blurry fixture", async () => {
    const result = await extractKnowledgeSourceText({
      bytes: buildTestJpegBytes(),
      filename: "p2c-b1-blurry-uncertain.jpeg",
      mimeType: "image/jpeg",
    });
    assert.match(result.text, /5\?\s*万/);
    assert.ok(
      result.extractionMetadata?.warnings.some(
        (warning) => warning.code === "UNREADABLE_NUMBER",
      ),
    );
  });

  it("transcribes prompt injection image as plain text", async () => {
    const result = await extractKnowledgeSourceText({
      bytes: buildTestPngBytes(),
      filename: "p2c-b1-prompt-injection.png",
      mimeType: "image/png",
    });
    assert.match(result.text, /Ignore previous instructions/i);
  });

  it("serializes and parses extraction metadata", () => {
    const metadata = buildVisionExtractionMetadata({
      quality: "medium",
      warnings: [{ code: "BLURRY_IMAGE", message: "图片较模糊" }],
    });
    const parsed = parseVisionExtractionMetadata(
      serializeVisionExtractionMetadata(metadata),
    );
    assert.equal(parsed?.quality, "medium");
    assert.equal(parsed?.warnings.length, 1);
  });

  it("mock duplicate fixture is deterministic", () => {
    const bytes = buildTestPngBytes();
    const first = mockKnowledgeVisionExtract({
      bytes,
      filename: "p2c-b1-duplicate.png",
    });
    const second = mockKnowledgeVisionExtract({
      bytes,
      filename: "p2c-b1-duplicate.png",
    });
    assert.equal(first.text, second.text);
  });
});
