import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHighRiskAttachmentType } from "@/lib/mail/compose-attachment-policy";
import { classifyComposeAttachmentDeliveryMode } from "./large-attachment-classifier";
import { LARGE_ATTACHMENT_MAX_FILE_BYTES } from "./large-attachment-policy";
import { presignLargeAttachmentPut } from "./large-attachment-r2-s3-client";

const CONTENT_MD5 = "1B2M2Y8AsgTpgAmY7PhCfg==";
const FAKE_ENV = {
  accountId: "00000000000000000000000000000000",
  accessKeyId: "fake-access-key",
  secretAccessKey: "fake-secret-key",
  bucketName: "crm-mail-large-attachments" as const,
  endpoint:
    "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
};

async function presignFor(contentType: string) {
  return presignLargeAttachmentPut({
    storageKey: "mail/large-attachments/2026/09/09/opaque",
    contentType,
    contentMd5Base64: CONTENT_MD5,
    expiresInSeconds: 600,
    env: FAKE_ENV,
  });
}

describe("Large Attachment R2 presign contract", () => {
  it("omits automatic CRC32 parameters and signs required headers", async () => {
    for (const contentType of ["video/quicktime", "application/pdf"]) {
      const result = await presignFor(contentType);
      const url = new URL(result.uploadUrl);
      const signedHeaders = new Set(
        url.searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [],
      );

      assert.equal(
        url.searchParams.has("x-amz-sdk-checksum-algorithm"),
        false,
      );
      assert.equal(url.searchParams.has("x-amz-checksum-crc32"), false);
      assert.deepEqual(
        signedHeaders,
        new Set(["content-md5", "content-type", "host", "if-none-match"]),
      );
      assert.deepEqual(result.requiredHeaders, {
        "Content-Type": contentType,
        "Content-MD5": CONTENT_MD5,
        "If-None-Match": "*",
      });
    }
  });

  it("keeps MOV allowed, PDF large, ordinary direct, and blocked extensions blocked", () => {
    assert.equal(
      isHighRiskAttachmentType({
        filename: "IMG_5940.mov",
        mimeType: "video/quicktime",
      }),
      false,
    );
    assert.deepEqual(
      classifyComposeAttachmentDeliveryMode({
        filename: "IMG_5940.mov",
        mimeType: "video/quicktime",
        sizeBytes: 17_581_697,
        existingAttachments: [],
      }),
      { ok: true, deliveryMode: "large_attachment" },
    );
    assert.deepEqual(
      classifyComposeAttachmentDeliveryMode({
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4 * 1024 * 1024,
        existingAttachments: [],
      }),
      { ok: true, deliveryMode: "large_attachment" },
    );
    assert.deepEqual(
      classifyComposeAttachmentDeliveryMode({
        filename: "note.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1 * 1024 * 1024,
        existingAttachments: [],
      }),
      { ok: true, deliveryMode: "direct_attachment" },
    );
    assert.deepEqual(
      classifyComposeAttachmentDeliveryMode({
        filename: "setup.exe",
        mimeType: "application/octet-stream",
        sizeBytes: LARGE_ATTACHMENT_MAX_FILE_BYTES - 1,
        existingAttachments: [],
      }),
      { ok: false, code: "UNSUPPORTED_FILE_TYPE" },
    );
  });
});
