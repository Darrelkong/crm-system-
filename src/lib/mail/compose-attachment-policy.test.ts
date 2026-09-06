import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAIL_COMPOSE_ATTACHMENT_LIMITS,
  isBlockedAttachmentFilename,
  isBlockedLargeAttachmentFilename,
  isBlockedAttachmentMimeType,
  isHighRiskAttachmentType,
  isZipAttachmentFilename,
  normalizeAttachmentFilename,
  normalizeLargeAttachmentFilename,
  validateComposeAttachmentCandidate,
} from "@/lib/mail/compose-attachment-policy";

describe("compose-attachment-policy", () => {
  it("accepts a valid PDF attachment candidate", () => {
    const issue = validateComposeAttachmentCandidate({
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      existingAttachmentCount: 0,
      existingTotalBytes: 0,
    });
    assert.equal(issue, null);
  });

  it("rejects oversize single files", () => {
    const issue = validateComposeAttachmentCandidate({
      filename: "large.pdf",
      mimeType: "application/pdf",
      sizeBytes: MAIL_COMPOSE_ATTACHMENT_LIMITS.maxSingleFileBytes + 1,
      existingAttachmentCount: 0,
      existingTotalBytes: 0,
    });
    assert.equal(issue?.code, "FILE_TOO_LARGE");
  });

  it("rejects total size overflow across attachments", () => {
    const issue = validateComposeAttachmentCandidate({
      filename: "second.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      existingAttachmentCount: 1,
      existingTotalBytes: MAIL_COMPOSE_ATTACHMENT_LIMITS.maxTotalBytes - 512,
    });
    assert.equal(issue?.code, "TOTAL_SIZE_EXCEEDED");
  });

  it("blocks executable filenames and script mime types", () => {
    assert.equal(isBlockedAttachmentFilename("setup.exe"), true);
    assert.equal(isBlockedAttachmentMimeType("application/javascript"), true);
    const issue = validateComposeAttachmentCandidate({
      filename: "run.exe",
      mimeType: "application/pdf",
      sizeBytes: 100,
      existingAttachmentCount: 0,
      existingTotalBytes: 0,
    });
    assert.equal(issue?.code, "UNSUPPORTED_FILE_TYPE");
  });

  it("blocks uppercase and disguised executable filenames", () => {
    for (const filename of ["setup.EXE", "invoice.pdf.exe", "photo.jpg.scr"]) {
      assert.equal(isBlockedAttachmentFilename(filename), true);
    }
    assert.equal(isBlockedLargeAttachmentFilename("disk.iso"), true);
    assert.equal(isBlockedLargeAttachmentFilename("shortcut.lnk"), true);
  });

  it("normalizes trailing dots and spaces before evaluating extensions", () => {
    assert.equal(normalizeAttachmentFilename("invoice.pdf.exe. "), "invoice.pdf.exe.");
    assert.equal(
      normalizeLargeAttachmentFilename("invoice.pdf.exe. "),
      "invoice.pdf.exe",
    );
    assert.equal(isBlockedLargeAttachmentFilename("invoice.pdf.exe. "), true);
    assert.equal(
      isHighRiskAttachmentType({
        filename: "bad\nname.pdf",
        mimeType: "application/pdf",
      }),
      true,
    );
  });

  it("allows safe business documents and ZIP with explicit warning semantics", () => {
    for (const filename of ["report.pdf", "brief.docx", "numbers.xlsx", "photo.png"]) {
      assert.equal(isBlockedAttachmentFilename(filename), false);
    }
    assert.equal(isZipAttachmentFilename("documents.zip"), true);
    assert.equal(isBlockedAttachmentFilename("documents.zip"), false);
  });
});
