import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import {
  buildFileSourceMetaLine,
  formatFileTypeLabel,
  formatSelectedFileSize,
  isScannedPdfFailure,
} from "@/lib/knowledge/knowledge-ingest-upload-ui";

describe("Knowledge ingest upload UI helpers", () => {
  it("formats file sizes for mobile display", () => {
    assert.equal(formatSelectedFileSize(512), "512 B");
    assert.equal(formatSelectedFileSize(12_288), "12 KB");
    assert.equal(formatSelectedFileSize(2_097_152), "2.0 MB");
  });

  it("formats file type labels from filenames", () => {
    assert.equal(formatFileTypeLabel("p2c-a1-simple.docx"), "DOCX");
    assert.equal(formatFileTypeLabel("notes.md"), "Markdown");
    assert.equal(formatFileTypeLabel("report.pdf"), "PDF");
    assert.equal(formatFileTypeLabel("plain.txt"), "TXT");
  });

  it("builds file source meta lines for list cards", () => {
    assert.equal(
      buildFileSourceMetaLine(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "p2c-a1-simple.docx",
        12_288,
      ),
      "DOCX · 12 KB",
    );
  });

  it("detects scanned PDF failure codes", () => {
    assert.equal(
      isScannedPdfFailure(KNOWLEDGE_ERROR_CODES.SCANNED_PDF_UNSUPPORTED),
      true,
    );
    assert.equal(isScannedPdfFailure(null), false);
  });
});
