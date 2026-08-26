import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findInboundDangerousAttachmentViolation,
  isDangerousInboundAttachmentFilename,
  normalizeInboundAttachmentFilename,
} from "@/lib/mail/inbound-dangerous-attachment-policy";

describe("inbound dangerous attachment policy", () => {
  it("blocks executable extensions case-insensitively", () => {
    assert.equal(isDangerousInboundAttachmentFilename("setup.EXE"), true);
    assert.equal(isDangerousInboundAttachmentFilename("readme.txt"), false);
  });

  it("normalizes trailing dots and spaces before extension checks", () => {
    assert.equal(
      normalizeInboundAttachmentFilename("invoice.pdf   "),
      "invoice.pdf",
    );
    assert.equal(isDangerousInboundAttachmentFilename("payload.js. "), true);
  });

  it("blocks script-oriented extensions from V1 list", () => {
    const violation = findInboundDangerousAttachmentViolation({
      filename: "run.ps1",
      mimeType: "application/octet-stream",
      sizeBytes: 10,
    });
    assert.equal(violation?.reason, "blocked_extension");
  });
});
