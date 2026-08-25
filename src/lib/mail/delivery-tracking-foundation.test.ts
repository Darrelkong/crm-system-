import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  mapProviderEventKindToDeliveryEventType,
  normalizeProviderDeliveryEventType,
  normalizeProviderDeliveryWebhookPayload,
} from "@/lib/mail/delivery-event-normalization";
import {
  signDeliveryWebhookRequest,
  validateDeliveryWebhookSecurity,
} from "@/lib/mail/delivery-webhook-signature";
import { MailServiceError } from "@/lib/mail/errors";
import { getSendOperationDeliveryLifecycle } from "@/lib/mail/send-operation-delivery-service";
import { projectSendDeliveryLifecycle } from "@/lib/mail/send-operation-delivery-projection";

describe("delivery event normalization", () => {
  it("maps provider event aliases to canonical delivery types", () => {
    assert.equal(normalizeProviderDeliveryEventType("delivered"), "delivered");
    assert.equal(normalizeProviderDeliveryEventType("hard_bounce"), "bounced");
    assert.equal(normalizeProviderDeliveryEventType("complaint"), "complaint");
    assert.equal(mapProviderEventKindToDeliveryEventType("complaint"), "bounced");
    assert.equal(mapProviderEventKindToDeliveryEventType("accepted"), null);
  });

  it("normalizes webhook payloads into staging-ready events", () => {
    const normalized = normalizeProviderDeliveryWebhookPayload({
      provider: "cloudflare-email-sending-outbound",
      payload: {
        eventId: "evt-1",
        eventType: "delivered",
        messageId: "msg-123",
        requestId: "req-123",
        recipient: "client@example.com",
        occurredAt: "2026-08-22T10:00:00.000Z",
      },
    });

    assert.equal(normalized.deliveryEventType, "delivered");
    assert.equal(normalized.providerMessageId, "msg-123");
    assert.equal(normalized.providerRequestId, "req-123");
    assert.equal(normalized.lifecycleHint, null);
  });

  it("maps complaint events to bounced storage with complaint lifecycle hint", () => {
    const normalized = normalizeProviderDeliveryWebhookPayload({
      provider: "cloudflare-email-sending-outbound",
      payload: {
        eventId: "evt-complaint",
        eventType: "complaint",
        messageId: "msg-complaint",
        recipient: "client@example.com",
        reason: "spam complaint",
      },
    });

    assert.equal(normalized.deliveryEventType, "bounced");
    assert.equal(normalized.lifecycleHint, "complaint");
  });
});

describe("delivery webhook signature verification", () => {
  const secret = "foundation-test-secret";

  it("requires valid HMAC signature", () => {
    const rawBody = "{}";
    assert.equal(
      validateDeliveryWebhookSecurity(
        {
          provider: "fake-local",
          signatureHeader: null,
          rawBody,
        },
        { webhookSecret: secret },
      ).ok,
      false,
    );
    const signed = signDeliveryWebhookRequest({ secret, rawBody });
    assert.equal(
      validateDeliveryWebhookSecurity(
        {
          provider: "fake-local",
          signatureHeader: signed.signatureHeader,
          timestampHeader: signed.timestampHeader,
          rawBody,
        },
        { webhookSecret: secret },
      ).ok,
      true,
    );
  });
});

describe("send delivery lifecycle projection", () => {
  it("maps transport accepted to delivered when all recipients delivered", () => {
    const projection = projectSendDeliveryLifecycle({
      sendOperationId: "send-1",
      sendStatus: "accepted",
      hasRfcIdentity: true,
      revisionRecipients: [
        { id: "recipient-1", address: "client@example.com", recipientType: "to" },
      ],
      deliveryEvents: [
        {
          id: "event-1",
          recipientId: "recipient-1",
          recipientAddress: "client@example.com",
          recipientType: "to",
          eventType: "delivered",
          lifecycleHint: null,
          receivedAt: "2026-08-22T10:00:00.000Z",
          providerEventId: "evt-1",
          diagnosticMessage: null,
        },
      ],
    });

    assert.equal(projection.lifecyclePhase, "delivered");
    assert.equal(projection.recipients[0]?.outcome, "delivered");
  });

  it("maps send failure independently from delivery events", () => {
    const projection = projectSendDeliveryLifecycle({
      sendOperationId: "send-1",
      sendStatus: "failed",
      hasRfcIdentity: true,
      revisionRecipients: [],
      deliveryEvents: [],
    });

    assert.equal(projection.lifecyclePhase, "failed");
    assert.equal(projection.transportPhase, "failed");
  });

  it("maps queued and processing transport states", () => {
    assert.equal(
      projectSendDeliveryLifecycle({
        sendOperationId: "send-1",
        sendStatus: "pending",
        hasRfcIdentity: false,
        revisionRecipients: [],
        deliveryEvents: [],
      }).lifecyclePhase,
      "queued",
    );
    assert.equal(
      projectSendDeliveryLifecycle({
        sendOperationId: "send-1",
        sendStatus: "processing",
        hasRfcIdentity: true,
        revisionRecipients: [],
        deliveryEvents: [],
      }).lifecyclePhase,
      "processing",
    );
    assert.equal(
      projectSendDeliveryLifecycle({
        sendOperationId: "send-1",
        sendStatus: "accepted",
        hasRfcIdentity: true,
        revisionRecipients: [
          { id: "recipient-1", address: "client@example.com", recipientType: "to" },
        ],
        deliveryEvents: [],
      }).lifecyclePhase,
      "accepted",
    );
  });
});

describe("send operation delivery lifecycle permissions", () => {
  const disabledActor: MailActorContext = {
    userId: "user-1",
    sessionId: null,
    crmRole: "staff",
    mailAccessEnabled: false,
    adminGrants: [],
    audit: {},
  };

  it("requires mail access before loading delivery lifecycle", async () => {
    await assert.rejects(
      () => getSendOperationDeliveryLifecycle({} as never, disabledActor, "send-1"),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });
});
