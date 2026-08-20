import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertDeliveryEventSemanticGraphsEqual,
  deliveryEventSemanticGraphsEqual,
  type DeliveryEventSemanticGraph,
} from "@/lib/mail/delivery-event-semantic-comparison";
import { MailServiceError } from "@/lib/mail/errors";

const baseGraph = (): DeliveryEventSemanticGraph => ({
  sendOperationId: "send-1",
  transportAttemptId: "attempt-1",
  outboundRevisionId: "rev-1",
  outboundRevisionRecipientId: "recipient-1",
  eventType: "delivered",
  eventDedupeKey: "delivery:v1:p:evt:a@test.com:delivered",
  providerEventId: "evt",
  providerOccurredAt: "2026-01-01T00:00:00.000Z",
  smtpStatusCode: null,
  smtpEnhancedStatusCode: null,
  diagnosticMessage: null,
});

describe("deliveryEventSemanticGraphsEqual", () => {
  it("treats identical graphs as equal", () => {
    const left = baseGraph();
    const right = baseGraph();
    assert.equal(deliveryEventSemanticGraphsEqual(left, right), true);
    assert.doesNotThrow(() =>
      assertDeliveryEventSemanticGraphsEqual(left, right),
    );
  });

  it("detects differing event types", () => {
    const left = baseGraph();
    const right = { ...baseGraph(), eventType: "bounced" as const };
    assert.equal(deliveryEventSemanticGraphsEqual(left, right), false);
    assert.throws(
      () => assertDeliveryEventSemanticGraphsEqual(left, right),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "INTEGRITY_CONFLICT",
    );
  });

  it("detects differing recipient provenance", () => {
    const left = baseGraph();
    const right = {
      ...baseGraph(),
      outboundRevisionRecipientId: "recipient-2",
    };
    assert.equal(deliveryEventSemanticGraphsEqual(left, right), false);
  });
});
