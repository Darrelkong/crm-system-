import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHighRiskAttachmentType } from "@/lib/mail/compose-attachment-policy";
import { classifyComposeAttachmentDeliveryMode } from "./large-attachment-classifier";
import { LARGE_ATTACHMENT_MAX_FILE_BYTES } from "./large-attachment-policy";
import {
  headLargeAttachmentObjectViaS3,
  presignLargeAttachmentPut,
} from "./large-attachment-r2-s3-client";
import type { S3Client } from "@aws-sdk/client-s3";

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
  it("creates an HTTPS R2 URL for the dedicated bucket and opaque key", async () => {
    const result = await presignFor("video/quicktime");
    const url = new URL(result.uploadUrl);

    assert.equal(url.protocol, "https:");
    assert.equal(
      url.hostname,
      "00000000000000000000000000000000.r2.cloudflarestorage.com",
    );
    assert.equal(
      url.pathname,
      "/crm-mail-large-attachments/mail/large-attachments/2026/09/09/opaque",
    );
  });

  it("preserves the existing expiry and SigV4 query contract", async () => {
    const url = new URL((await presignFor("video/quicktime")).uploadUrl);

    assert.equal(url.searchParams.get("X-Amz-Expires"), "600");
    assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.ok(url.searchParams.get("X-Amz-Credential")?.startsWith("fake-access-key/"));
    assert.ok(url.searchParams.get("X-Amz-Signature"));
  });

  it("signs the exact browser headers and preserves the response contract", async () => {
    const result = await presignFor("video/quicktime");
    const url = new URL(result.uploadUrl);
    const signedHeaders = new Set(
      url.searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [],
    );

    assert.deepEqual(
      signedHeaders,
      new Set(["content-md5", "content-type", "host", "if-none-match"]),
    );
    assert.deepEqual(result.requiredHeaders, {
      "Content-Type": "video/quicktime",
      "Content-MD5": CONTENT_MD5,
      "If-None-Match": "*",
    });
  });

  it("keeps Content-Type and integrity headers bound without CRC32 parameters", async () => {
    const result = await presignFor("application/pdf");
    const url = new URL(result.uploadUrl);

    assert.equal(result.requiredHeaders["Content-Type"], "application/pdf");
    assert.equal(result.requiredHeaders["Content-MD5"], CONTENT_MD5);
    assert.equal(result.requiredHeaders["If-None-Match"], "*");
    assert.equal(url.searchParams.has("x-amz-sdk-checksum-algorithm"), false);
    assert.equal(url.searchParams.has("x-amz-checksum-crc32"), false);
    assert.equal(
      JSON.stringify(result.requiredHeaders).includes(FAKE_ENV.secretAccessKey),
      false,
    );
    assert.equal(result.uploadUrl.includes(FAKE_ENV.secretAccessKey), false);
  });

  it("retains S3 HeadObject verification behavior", async () => {
    const result = await headLargeAttachmentObjectViaS3({
      storageKey: "mail/large-attachments/2026/09/09/opaque",
      env: FAKE_ENV,
      client: {
        send: async () => ({
          ContentLength: 123,
          ETag: '"etag-1"',
          ContentType: "application/pdf",
        }),
      } as unknown as S3Client,
    });

    assert.deepEqual(result, {
      storageKey: "mail/large-attachments/2026/09/09/opaque",
      sizeBytes: 123,
      etag: "etag-1",
      contentType: "application/pdf",
      storageVersion: null,
    });
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
