import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DELIVERY_WEBHOOK_MAX_TIMESTAMP_AGE_SECONDS,
  formatDeliveryWebhookSignatureHeader,
  signDeliveryWebhookRequest,
  validateDeliveryWebhookSecurity,
} from "@/lib/mail/delivery-webhook-signature";

const TEST_SECRET = "unit-test-delivery-webhook-secret";

function samplePayload(eventId = "evt-security-1") {
  return {
    eventId,
    eventType: "delivered",
    messageId: "msg-security-1",
    recipient: "client@example.com",
  };
}

function signedRequest(input?: {
  rawBody?: string;
  timestampSeconds?: number;
  secret?: string;
  signatureHeader?: string | null;
  timestampHeader?: string | null;
  nowMs?: number;
}) {
  const payload = samplePayload();
  const rawBody = input?.rawBody ?? JSON.stringify(payload);
  const secret = input?.secret ?? TEST_SECRET;
  const timestampSeconds =
    input?.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const signed =
    input?.signatureHeader === undefined
      ? signDeliveryWebhookRequest({
          secret,
          rawBody,
          timestampSeconds,
        })
      : {
          signatureHeader: input.signatureHeader,
          timestampHeader: input.timestampHeader ?? String(timestampSeconds),
        };

  return {
    provider: "fake-local",
    payload: JSON.parse(rawBody) as ReturnType<typeof samplePayload>,
    rawBody,
    signatureHeader: signed.signatureHeader,
    timestampHeader: signed.timestampHeader,
    receivedAt: new Date().toISOString(),
    security: {
      webhookSecret: secret,
      nowMs: input?.nowMs,
    },
  };
}

describe("delivery webhook signature verification", () => {
  it("accepts a valid HMAC signature", () => {
    const rawBody = JSON.stringify(samplePayload());
    const timestampSeconds = 1_700_000_000;
    const signatureHeader = formatDeliveryWebhookSignatureHeader({
      secret: TEST_SECRET,
      timestampSeconds,
      rawBody,
    });

    const result = validateDeliveryWebhookSecurity(
      {
        provider: "fake-local",
        signatureHeader,
        timestampHeader: String(timestampSeconds),
        rawBody,
      },
      {
        webhookSecret: TEST_SECRET,
        nowMs: timestampSeconds * 1000 + 1_000,
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.mode, "hmac_sha256");
      assert.equal(result.timestampSeconds, timestampSeconds);
    }
  });

  it("rejects invalid signatures", () => {
    const request = signedRequest();
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const result = validateDeliveryWebhookSecurity(
      {
        provider: request.provider,
        signatureHeader: `t=${timestampSeconds},v1=deadbeef`,
        timestampHeader: String(timestampSeconds),
        rawBody: request.rawBody,
      },
      { ...request.security, nowMs: timestampSeconds * 1000 },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejectionReason, "invalid_signature");
    }
  });

  it("rejects expired timestamps", () => {
    const nowMs = Date.now();
    const expiredTimestamp = Math.floor(nowMs / 1000) - DEFAULT_DELIVERY_WEBHOOK_MAX_TIMESTAMP_AGE_SECONDS - 10;
    const result = validateDeliveryWebhookSecurity(
      {
        provider: "fake-local",
        signatureHeader: formatDeliveryWebhookSignatureHeader({
          secret: TEST_SECRET,
          timestampSeconds: expiredTimestamp,
          rawBody: JSON.stringify(samplePayload()),
        }),
        timestampHeader: String(expiredTimestamp),
        rawBody: JSON.stringify(samplePayload()),
      },
      {
        webhookSecret: TEST_SECRET,
        nowMs,
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejectionReason, "expired_timestamp");
    }
  });

  it("rejects requests when webhook secret is not configured", () => {
    const request = signedRequest();
    const result = validateDeliveryWebhookSecurity(
      {
        provider: request.provider,
        signatureHeader: request.signatureHeader,
        timestampHeader: request.timestampHeader,
        rawBody: request.rawBody,
      },
      { webhookSecret: null },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejectionReason, "missing_secret");
    }
  });
});

describe("delivery webhook receiver security flow", () => {
  it("maps missing signature to validation failure reason", () => {
    const result = validateDeliveryWebhookSecurity(
      {
        provider: "fake-local",
        signatureHeader: null,
        rawBody: JSON.stringify(samplePayload()),
      },
      { webhookSecret: TEST_SECRET },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejectionReason, "missing_signature");
    }
  });

  it("maps invalid signature to forbidden-class rejection reason", () => {
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const result = validateDeliveryWebhookSecurity(
      {
        provider: "fake-local",
        signatureHeader: `t=${timestampSeconds},v1=deadbeef`,
        timestampHeader: String(timestampSeconds),
        rawBody: JSON.stringify(samplePayload()),
      },
      { webhookSecret: TEST_SECRET, nowMs: timestampSeconds * 1000 },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejectionReason, "invalid_signature");
    }
  });
});

describe("delivery webhook audit actions", () => {
  it("defines accepted and rejected webhook audit actions", async () => {
    const { MAIL_AUDIT_ACTIONS } = await import("@/lib/mail/constants");
    assert.equal(
      MAIL_AUDIT_ACTIONS.deliveryWebhookAccepted,
      "mail.delivery_webhook.accepted",
    );
    assert.equal(
      MAIL_AUDIT_ACTIONS.deliveryWebhookRejected,
      "mail.delivery_webhook.rejected",
    );
  });
});
