import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import { resolveMailAttachmentDownloadContentType } from "@/lib/mail/mail-attachment-download-content-type";
import {
  buildMailAttachmentContentDispositionHeader,
  resolveMailAttachmentDownloadFilename,
} from "@/lib/mail/mail-attachment-download-content-disposition";
import { LOCAL_MAIL_ATTACHMENT_VERIFY_HEADER_INJECTION_FILENAME } from "@/lib/mail/local-attachment-verification-fixture/constants";

describe("mail attachment download headers", () => {
  it("maps unknown MIME to application/octet-stream", () => {
    assert.equal(
      resolveMailAttachmentDownloadContentType("application/x-evil"),
      "application/octet-stream",
    );
  });

  it("preserves allow-listed MIME types", () => {
    assert.equal(
      resolveMailAttachmentDownloadContentType("application/PDF"),
      "application/pdf",
    );
    assert.equal(resolveMailAttachmentDownloadContentType("image/png"), "image/png");
  });

  it("always emits attachment disposition", () => {
    const header = buildMailAttachmentContentDispositionHeader("report.pdf");
    assert.match(header, /^attachment;/);
    assert.match(header, /filename="/);
    assert.match(header, /filename\*=UTF-8''/);
  });

  it("strips CR/LF from filenames", () => {
    const filename = resolveMailAttachmentDownloadFilename({
      displayFilename: 'bad\r\nname.pdf',
      originalFilename: "fallback.pdf",
    });
    assert.equal(filename.includes("\r"), false);
    assert.equal(filename.includes("\n"), false);
    const header = buildMailAttachmentContentDispositionHeader(filename);
    assert.equal(header.includes("\r"), false);
    assert.equal(header.includes("\n"), false);
  });

  it("neutralizes quote and header injection attempts", () => {
    const header = buildMailAttachmentContentDispositionHeader(
      LOCAL_MAIL_ATTACHMENT_VERIFY_HEADER_INJECTION_FILENAME,
    );
    assert.equal(header.includes("\r"), false);
    assert.equal(header.includes("\n"), false);
    assert.match(header, /^attachment;/);
    assert.equal(header.split("; filename=").length >= 2, true);
  });

  it("encodes Unicode filename*", () => {
    const header = buildMailAttachmentContentDispositionHeader("報告.pdf");
    assert.match(header, /filename\*=UTF-8''/);
    assert.match(header, /%E5%A0%B1%E5%91%8A\.pdf/);
  });

  it("prefers display filename over original", () => {
    assert.equal(
      resolveMailAttachmentDownloadFilename({
        displayFilename: "display.pdf",
        originalFilename: "original.pdf",
      }),
      "display.pdf",
    );
  });
});

describe("mail attachment download content hash helper", () => {
  it("uses lowercase sha256 hex", () => {
    const bytes = new TextEncoder().encode("fixture");
    const hash = computeInboundPayloadContentHash(bytes);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});
