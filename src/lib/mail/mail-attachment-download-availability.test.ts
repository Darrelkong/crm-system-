import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMailAttachmentDownloadAvailable } from "@/lib/mail/mail-attachment-download-availability";

describe("isMailAttachmentDownloadAvailable", () => {
  it("returns true for clean direct_attachment", () => {
    assert.equal(
      isMailAttachmentDownloadAvailable({
        deliveryMode: "direct_attachment",
        securityScanStatus: "clean",
      }),
      true,
    );
  });

  for (const scanStatus of ["unscanned", "blocked", "scan_failed"] as const) {
    it(`returns false for ${scanStatus}`, () => {
      assert.equal(
        isMailAttachmentDownloadAvailable({
          deliveryMode: "direct_attachment",
          securityScanStatus: scanStatus,
        }),
        false,
      );
    });
  }

  it("returns false for secure_file even when clean", () => {
    assert.equal(
      isMailAttachmentDownloadAvailable({
        deliveryMode: "secure_file",
        securityScanStatus: "clean",
      }),
      false,
    );
  });
});
