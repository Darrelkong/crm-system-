import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLOUDFLARE_EMAIL_ROUTING_PROVIDER } from "@/lib/mail/inbound-ingress-constants";
import {
  buildCloudflareEmailStagingInput,
  InboundEmailIngressError,
  readInboundRawMimeBytes,
} from "@/lib/mail/cloudflare-email-inbound-adapter";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";

function mockEmailMessage(input: {
  from?: string;
  to?: string;
  rawBytes: Uint8Array;
}): {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
} {
  return {
    from: input.from ?? "sender@external.test",
    to: input.to ?? "daniel.hayes@echfronthk.com",
    headers: new Headers(),
    rawSize: input.rawBytes.byteLength,
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(input.rawBytes);
        controller.close();
      },
    }),
  };
}

function sampleMime(extra = ""): Uint8Array {
  return new TextEncoder().encode(
    `From: Sender <sender@external.test>\r\nTo: Daniel <daniel.hayes@echfronthk.com>\r\nSubject: Adapter test\r\nMessage-ID: <adapter-${Date.now()}@external.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello${extra}`,
  );
}

describe("cloudflare email inbound adapter", () => {
  it("fingerprints raw bytes once and builds deterministic staging input", async () => {
    const bytes = sampleMime();
    const message = mockEmailMessage({ rawBytes: bytes });
    const rawMime = await readInboundRawMimeBytes(message);

    assert.equal(rawMime.sizeBytes, bytes.byteLength);
    assert.equal(
      rawMime.fingerprint,
      computeInboundPayloadContentHash(bytes),
    );
    assert.equal(rawMime.providerEventId, rawMime.fingerprint);

    const stagingInput = buildCloudflareEmailStagingInput({
      message,
      rawMime,
      receivedAt: "2026-08-26T14:00:00.000Z",
    });

    assert.equal(stagingInput.provider, CLOUDFLARE_EMAIL_ROUTING_PROVIDER);
    assert.equal(stagingInput.providerEventId, rawMime.providerEventId);
    assert.deepEqual(stagingInput.envelopeRecipients, [
      "daniel.hayes@echfronthk.com",
    ]);
    assert.equal(stagingInput.receivedAt, "2026-08-26T14:00:00.000Z");
  });

  it("rejects oversized rawSize before reading stream", async () => {
    const bytes = sampleMime();
    const message = mockEmailMessage({ rawBytes: bytes });
    message.rawSize = bytes.byteLength + 1;

    await assert.rejects(
      () => readInboundRawMimeBytes(message, bytes.byteLength),
      (error: unknown) => {
        assert.ok(error instanceof InboundEmailIngressError);
        assert.equal(error.code, "MIME_TOO_LARGE");
        return true;
      },
    );
  });

  it("requires Cloudflare envelope recipient via message.to", () => {
    const bytes = sampleMime();
    const message = mockEmailMessage({ rawBytes: bytes, to: "  " });

    assert.throws(
      () =>
        buildCloudflareEmailStagingInput({
          message,
          rawMime: {
            bytes,
            fingerprint: "abc",
            providerEventId: "a".repeat(64),
            sizeBytes: bytes.byteLength,
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof InboundEmailIngressError);
        assert.equal(error.code, "MISSING_ENVELOPE_RECIPIENT");
        return true;
      },
    );
  });
});
