import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import {
  computeInboundRawMimeFingerprint,
  formatCloudflareEmailProviderEventId,
} from "@/lib/mail/inbound-ingress-fingerprint";

describe("inbound ingress fingerprint", () => {
  it("matches node SHA-256 hash for identical bytes", async () => {
    const bytes = new TextEncoder().encode("From: a@test\n\nhello");
    const webHash = await computeInboundRawMimeFingerprint(bytes);
    const nodeHash = computeInboundPayloadContentHash(bytes);
    assert.equal(webHash, nodeHash);
    assert.equal(formatCloudflareEmailProviderEventId(webHash), webHash);
  });

  it("rejects invalid fingerprint formatting", () => {
    assert.throws(
      () => formatCloudflareEmailProviderEventId("not-a-hash"),
      /Invalid inbound raw MIME fingerprint/,
    );
  });
});
