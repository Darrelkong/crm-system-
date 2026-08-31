import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  computeContentMd5Base64,
  computeDeclaredSha256Hex,
  computeFileContentDigests,
  FILE_CONTENT_DIGEST_CHUNK_BYTES,
} from "@/lib/mail/client/file-content-digests";

function fileFromBytes(bytes: Uint8Array, name = "fixture.bin"): File {
  return new File([Buffer.from(bytes)], name, { type: "application/octet-stream" });
}

function wholeFileSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function wholeFileMd5Base64(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("base64");
}

describe("file content digests", () => {
  it("matches whole-file SHA-256 for empty, odd boundaries, and multi-chunk payloads", async () => {
    const fixtures = [
      new Uint8Array(0),
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      new Uint8Array(FILE_CONTENT_DIGEST_CHUNK_BYTES + 1),
      new Uint8Array(FILE_CONTENT_DIGEST_CHUNK_BYTES * 2 + 123),
    ];
    for (const bytes of fixtures) {
      if (bytes.length > 1) {
        bytes.fill(7);
      }
      const file = fileFromBytes(bytes);
      const digest = await computeDeclaredSha256Hex(file);
      assert.equal(digest, wholeFileSha256Hex(bytes));
      assert.match(digest, /^[0-9a-f]{64}$/);
    }
  });

  it("matches whole-file MD5 base64 and never returns hex", async () => {
    const bytes = new Uint8Array(FILE_CONTENT_DIGEST_CHUNK_BYTES * 2 + 17);
    bytes.fill(9);
    const file = fileFromBytes(bytes);
    const digest = await computeContentMd5Base64(file);
    assert.equal(digest, wholeFileMd5Base64(bytes));
    assert.doesNotMatch(digest, /^[0-9a-f]{32}$/i);
  });

  it("returns paired digests from computeFileContentDigests", async () => {
    const bytes = new Uint8Array(1024);
    bytes.fill(3);
    const file = fileFromBytes(bytes, "note.txt");
    const digests = await computeFileContentDigests(file);
    assert.equal(digests.declaredSha256, wholeFileSha256Hex(bytes));
    assert.equal(digests.contentMd5Base64, wholeFileMd5Base64(bytes));
  });
});
