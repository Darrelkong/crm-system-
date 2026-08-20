import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInboundIngestionDedupeKey } from "@/lib/mail/inbound-ingestion-dedupe-key";

describe("buildInboundIngestionDedupeKey", () => {
  it("includes provider, provider event id, and normalized recipient", () => {
    const key = buildInboundIngestionDedupeKey({
      provider: "fixture-provider",
      providerEventId: "evt-123",
      envelopeRecipientAddress: " User@Example.COM ",
    });
    assert.equal(
      key,
      "inbound:v1:fixture-provider:evt-123:user@example.com",
    );
  });

  it("falls back to provider message id when event id absent", () => {
    const key = buildInboundIngestionDedupeKey({
      provider: "p",
      providerMessageId: "msg-9",
      envelopeRecipientAddress: "a@test.com",
    });
    assert.equal(key, "inbound:v1:p:msg-9:a@test.com");
  });

  it("rejects missing provider identity", () => {
    assert.throws(() =>
      buildInboundIngestionDedupeKey({
        provider: "p",
        envelopeRecipientAddress: "a@test.com",
      }),
    );
  });
});
