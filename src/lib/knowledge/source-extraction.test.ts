import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  extractKnowledgeSourceText,
  extractKnowledgeText,
} from "@/lib/knowledge/source-extraction";
import { normalizeKnowledgeSourceText } from "@/lib/knowledge/source-text-normalization";
import {
  buildScannedPdfBytes,
  buildTestDocxBytes,
  buildTestTextPdfBytes,
} from "@/lib/knowledge/test-fixtures/source-documents";

function assertCode(action: () => Promise<unknown>, code: string) {
  return assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof KnowledgeServiceError);
    assert.equal(error.errorCode, code);
    return true;
  });
}

describe("Knowledge source extraction", () => {
  it("normalizes line endings and repeated blank lines conservatively", () => {
    assert.equal(
      normalizeKnowledgeSourceText("a\r\n\r\n\r\n\r\n\r\nb  \r\n"),
      "a\n\n\nb",
    );
  });

  it("extracts UTF-8 TXT and Markdown", async () => {
    const bytes = new TextEncoder().encode("# Title\n\nBody text.").buffer;
    const md = await extractKnowledgeSourceText({
      bytes,
      filename: "note.md",
    });
    assert.equal(md.format, "markdown");
    assert.match(md.text, /Title/);
    const txt = await extractKnowledgeText(bytes, ".md");
    assert.equal(txt.status, "ready");
  });

  it("rejects invalid UTF-8 text files", async () => {
    const bytes = Uint8Array.from([0xff, 0xfe, 0x00, 0x01]).buffer;
    await assertCode(
      () =>
        extractKnowledgeSourceText({
          bytes,
          filename: "broken.txt",
        }),
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
    );
  });

  it("extracts DOCX paragraphs and table text", async () => {
    const bytes = await buildTestDocxBytes({
      paragraphs: ["Policy paragraph"],
      table: [["Product", "Limit"], ["Alpha", "100"]],
    });
    const result = await extractKnowledgeSourceText({
      bytes,
      filename: "policy.docx",
    });
    assert.equal(result.format, "docx");
    assert.match(result.text, /Policy paragraph/);
    assert.match(result.text, /Product/);
    assert.match(result.text, /Alpha/);
  });

  it("fails safely on malformed and empty DOCX", async () => {
    const malformed = new TextEncoder().encode("not-a-docx").buffer;
    await assertCode(
      () =>
        extractKnowledgeSourceText({
          bytes: malformed,
          filename: "broken.docx",
        }),
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
    );
    const emptyDocx = await buildTestDocxBytes({ paragraphs: ["   "] });
    await assertCode(
      () =>
        extractKnowledgeSourceText({
          bytes: emptyDocx,
          filename: "empty.docx",
        }),
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
    );
  });

  it("extracts text-based PDF and preserves page order", async () => {
    const bytes = buildTestTextPdfBytes(["First page line", "Second page line"]);
    const result = await extractKnowledgeSourceText({
      bytes,
      filename: "policy.pdf",
    });
    assert.equal(result.format, "pdf");
    assert.match(result.text, /First page line/);
    assert.match(result.text, /Second page line/);
    const first = result.text.indexOf("First page line");
    const second = result.text.indexOf("Second page line");
    assert.ok(first >= 0 && second > first);
  });

  it("rejects scanned PDFs without a text layer", async () => {
    await assertCode(
      () =>
        extractKnowledgeSourceText({
          bytes: buildScannedPdfBytes(),
          filename: "scan.pdf",
        }),
      KNOWLEDGE_ERROR_CODES.SCANNED_PDF_UNSUPPORTED,
    );
  });

  it("rejects non-PDF bytes with .pdf extension", async () => {
    const bytes = new TextEncoder().encode("MZ executable").buffer;
    await assertCode(
      () =>
        extractKnowledgeSourceText({
          bytes,
          filename: "renamed.pdf",
        }),
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED,
    );
  });

  it("rejects unsupported extensions", async () => {
    const bytes = new TextEncoder().encode("hello").buffer;
    await assertCode(
      () =>
        extractKnowledgeSourceText({
          bytes,
          filename: "photo.png",
        }),
      KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_UNAVAILABLE,
    );
  });
});
