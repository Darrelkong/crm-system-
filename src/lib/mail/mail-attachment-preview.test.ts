import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveMailAttachmentDownloadable,
  resolveMailAttachmentPreviewContentType,
  resolveMailAttachmentPreviewType,
} from "@/lib/mail/mail-attachment-preview";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n");
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);

describe("mail attachment preview policy", () => {
  it("exposes preview types from trusted MIME", () => {
    assert.equal(
      resolveMailAttachmentPreviewType({
        mimeType: "application/pdf",
        filename: "file.bin",
      }),
      "pdf",
    );
    assert.equal(
      resolveMailAttachmentPreviewType({
        mimeType: "image/jpeg",
        filename: "file.bin",
      }),
      "image",
    );
    assert.equal(
      resolveMailAttachmentPreviewType({
        mimeType: "application/octet-stream",
        filename: "photo.PNG",
      }),
      "image",
    );
  });

  it("does not expose active or unsupported preview types", () => {
    for (const mimeType of [
      "text/html",
      "image/svg+xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip",
    ]) {
      assert.equal(
        resolveMailAttachmentPreviewType({ mimeType, filename: "file.bin" }),
        null,
      );
    }
  });

  it("requires matching safe byte signatures before inline preview", () => {
    assert.deepEqual(
      resolveMailAttachmentPreviewContentType({
        bytes: PDF_BYTES,
        mimeType: "application/octet-stream",
        filename: "file.pdf",
      }),
      { previewType: "pdf", contentType: "application/pdf" },
    );
    assert.deepEqual(
      resolveMailAttachmentPreviewContentType({
        bytes: PNG_BYTES,
        mimeType: "image/png",
        filename: "file.png",
      }),
      { previewType: "image", contentType: "image/png" },
    );
    assert.deepEqual(
      resolveMailAttachmentPreviewContentType({
        bytes: JPEG_BYTES,
        mimeType: "image/jpeg",
        filename: "file.jpg",
      }),
      { previewType: "image", contentType: "image/jpeg" },
    );
    assert.equal(
      resolveMailAttachmentPreviewContentType({
        bytes: new TextEncoder().encode("<html>"),
        mimeType: "text/html",
        filename: "file.html",
      }),
      null,
    );
  });

  it("allows direct unscanned downloads but denies blocked scan states", () => {
    assert.equal(
      resolveMailAttachmentDownloadable({
        deliveryMode: "direct_attachment",
        securityScanStatus: "unscanned",
      }),
      true,
    );
    assert.equal(
      resolveMailAttachmentDownloadable({
        deliveryMode: "direct_attachment",
        securityScanStatus: "blocked",
      }),
      false,
    );
    assert.equal(
      resolveMailAttachmentDownloadable({
        deliveryMode: "secure_file",
        securityScanStatus: "clean",
      }),
      false,
    );
  });
});
