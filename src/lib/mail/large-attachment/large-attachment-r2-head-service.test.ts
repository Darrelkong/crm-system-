import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LargeAttachmentAuthoritativeHeadResult } from "@/lib/mail/large-attachment/large-attachment-r2-head-service";

describe("large attachment storage version contract", () => {
  it("stores worker binding version when exposed and defers under S3 HEAD fallback", () => {
    const workerHead: LargeAttachmentAuthoritativeHeadResult = {
      storageKey: "mail/large-attachments/2026/08/30/obj",
      sizeBytes: 1024,
      etag: "etag-worker",
      contentType: "application/zip",
      storageVersion: "r2-version-id",
      versionProof: "worker_binding",
    };
    const s3Head: LargeAttachmentAuthoritativeHeadResult = {
      storageKey: workerHead.storageKey,
      sizeBytes: workerHead.sizeBytes,
      etag: "etag-s3",
      contentType: workerHead.contentType,
      storageVersion: null,
      versionProof: "deferred_s3_head",
    };

    assert.equal(workerHead.storageVersion, "r2-version-id");
    assert.notEqual(workerHead.storageVersion, workerHead.etag);
    assert.equal(s3Head.storageVersion, null);
    assert.notEqual(s3Head.storageVersion, s3Head.etag);
  });
});
