import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDeliveryIngestionDedupeKey } from "@/lib/mail/delivery-ingestion-dedupe-key";

describe("buildDeliveryIngestionDedupeKey", () => {
  it("includes provider, event id, normalized recipient, and event type", () => {
    const key = buildDeliveryIngestionDedupeKey({
      provider: "fake-local",
      providerEventId: "evt-1",
      recipientAddress: " User@Example.COM ",
      deliveryEventType: "delivered",
    });
    assert.equal(
      key,
      "delivery:v1:fake-local:evt-1:user@example.com:delivered",
    );
  });

  it("distinguishes event types for same provider event and recipient", () => {
    const delivered = buildDeliveryIngestionDedupeKey({
      provider: "p",
      providerEventId: "evt-9",
      recipientAddress: "a@test.com",
      deliveryEventType: "delivered",
    });
    const deferred = buildDeliveryIngestionDedupeKey({
      provider: "p",
      providerEventId: "evt-9",
      recipientAddress: "a@test.com",
      deliveryEventType: "deferred",
    });
    assert.notEqual(delivered, deferred);
  });

  it("rejects missing provider event id", () => {
    assert.throws(() =>
      buildDeliveryIngestionDedupeKey({
        provider: "p",
        providerEventId: " ",
        recipientAddress: "a@test.com",
        deliveryEventType: "bounced",
      }),
    );
  });
});
