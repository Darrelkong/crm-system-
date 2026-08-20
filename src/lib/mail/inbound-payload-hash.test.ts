import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeInboundPayloadContentHash,
  toPayloadByteArray,
} from "@/lib/mail/inbound-payload-hash";

describe("computeInboundPayloadContentHash", () => {
  it("returns lowercase sha256 hex of exact bytes", () => {
    const bytes = new TextEncoder().encode("From: a@test\n\nhello");
    const hash = computeInboundPayloadContentHash(bytes);
    assert.equal(hash.length, 64);
    assert.equal(hash, hash.toLowerCase());
    assert.match(hash, /^[0-9a-f]{64}$/);

    const emptyHash = computeInboundPayloadContentHash(new Uint8Array());
    assert.equal(
      emptyHash,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("accepts Buffer input via toPayloadByteArray", () => {
    const buffer = Buffer.from("mime-bytes");
    const hash = computeInboundPayloadContentHash(toPayloadByteArray(buffer));
    assert.equal(hash.length, 64);
  });
});
