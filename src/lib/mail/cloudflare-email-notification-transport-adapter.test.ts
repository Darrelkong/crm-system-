import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderNotificationPayload } from "@/lib/mail/notification-privacy-renderer";
import type { NotificationTransportInput } from "@/lib/mail/notification-transport-adapter";
import {
  buildCloudflareEmailNotificationSendRequestForTest,
  CloudflareEmailProviderError,
  CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES,
  CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
  CLOUDFLARE_EMAIL_NOTIFICATION_PROVIDER_ID,
  CLOUDFLARE_EMAIL_NOTIFICATION_SUBJECT,
  createCloudflareEmailNotificationTransport,
  type CloudflareEmailSendBinding,
  type CloudflareEmailSendRequest,
} from "@/lib/mail/cloudflare-email-notification-transport-adapter";

function sampleInput(
  overrides?: Partial<NotificationTransportInput>,
): NotificationTransportInput {
  return {
    targetEmail: "staff-alert@example.com",
    payload: renderNotificationPayload("new_incoming"),
    outboxId: "outbox-test-id-001",
    attemptNumber: 1,
    ...overrides,
  };
}

type CapturedSend = {
  request: CloudflareEmailSendRequest;
};

function createMockBinding(
  behavior:
    | { type: "success"; messageId: string }
    | { type: "throw"; error: CloudflareEmailProviderError }
    | { type: "resolve"; response: { messageId?: unknown } },
): CloudflareEmailSendBinding & { getLastSend: () => CapturedSend | null } {
  let last: CapturedSend | null = null;

  return {
    getLastSend: () => last,
    async send(request) {
      last = { request };
      if (behavior.type === "throw") {
        throw behavior.error;
      }
      if (behavior.type === "success") {
        return { messageId: behavior.messageId };
      }
      return { messageId: behavior.response.messageId as string };
    },
  };
}

describe("cloudflare email notification transport adapter", () => {
  it("freezes providerId as cloudflare-email-sending", () => {
    const binding = createMockBinding({
      type: "success",
      messageId: "msg-1",
    });
    const adapter = createCloudflareEmailNotificationTransport({
      emailBinding: binding,
    });
    assert.equal(adapter.providerId, CLOUDFLARE_EMAIL_NOTIFICATION_PROVIDER_ID);
    assert.equal(adapter.providerId, "cloudflare-email-sending");
  });

  describe("privacy-minimal send request", () => {
    it("sends generic subject/text only with infrastructure From", async () => {
      const binding = createMockBinding({
        type: "success",
        messageId: "0101018f-msg-abc",
      });
      const adapter = createCloudflareEmailNotificationTransport({
        emailBinding: binding,
      });
      const input = sampleInput({ targetEmail: "private-staff@gmail.com" });
      await adapter.send(input);

      const captured = binding.getLastSend();
      assert.ok(captured);
      assert.equal(captured.request.to, "private-staff@gmail.com");
      assert.deepEqual(captured.request.from, {
        email: CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
        name: "ECHFRONT CRM Mail",
      });
      assert.equal(captured.request.subject, CLOUDFLARE_EMAIL_NOTIFICATION_SUBJECT);
      assert.equal(captured.request.text, input.payload.bodyText);
      assert.equal("html" in captured.request, false);
      assert.equal("headers" in captured.request, false);
      assert.doesNotMatch(captured.request.subject, /outbox-test-id-001/);
      assert.doesNotMatch(captured.request.text ?? "", /outbox-test-id-001/);
    });

    it("test helper matches production request builder", () => {
      const body = buildCloudflareEmailNotificationSendRequestForTest(
        sampleInput(),
      );
      assert.equal(body.to, "staff-alert@example.com");
      assert.equal(
        typeof body.from === "object" ? body.from.email : body.from,
        CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
      );
    });
  });

  describe("accepted outcomes", () => {
    it("accepted + exact messageId", async () => {
      const messageId = "0101018f-7d0c-4d9a-msg-deadbeef";
      const adapter = createCloudflareEmailNotificationTransport({
        emailBinding: createMockBinding({ type: "success", messageId }),
      });

      const result = await adapter.send(sampleInput());
      assert.deepEqual(result, {
        outcome: "accepted",
        providerRequestId: messageId,
      });
    });
  });

  describe("malformed success", () => {
    it("missing messageId → ambiguous", async () => {
      const adapter = createCloudflareEmailNotificationTransport({
        emailBinding: createMockBinding({
          type: "resolve",
          response: {},
        }),
      });
      assert.deepEqual(await adapter.send(sampleInput()), { outcome: "ambiguous" });
    });

    it("empty messageId → ambiguous", async () => {
      const adapter = createCloudflareEmailNotificationTransport({
        emailBinding: createMockBinding({
          type: "resolve",
          response: { messageId: "   " },
        }),
      });
      assert.deepEqual(await adapter.send(sampleInput()), { outcome: "ambiguous" });
    });

    it("non-string messageId → ambiguous", async () => {
      const adapter = createCloudflareEmailNotificationTransport({
        emailBinding: createMockBinding({
          type: "resolve",
          response: { messageId: 12345 },
        }),
      });
      assert.deepEqual(await adapter.send(sampleInput()), { outcome: "ambiguous" });
    });
  });

  describe("permanent_failure mapping", () => {
    const permanentCases: Array<{
      code: string;
      expected: string;
    }> = [
      {
        code: "E_VALIDATION_ERROR",
        expected: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.validation,
      },
      {
        code: "E_FIELD_MISSING",
        expected: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.fieldMissing,
      },
      {
        code: "E_SENDER_NOT_VERIFIED",
        expected: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.senderNotVerified,
      },
      {
        code: "E_RECIPIENT_SUPPRESSED",
        expected: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.recipientSuppressed,
      },
      {
        code: "E_CONTENT_TOO_LARGE",
        expected: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.contentTooLarge,
      },
      {
        code: "E_RECIPIENT_NOT_ALLOWED",
        expected: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.recipientNotAllowed,
      },
      {
        code: "E_SENDER_DOMAIN_NOT_AVAILABLE",
        expected:
          CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.senderDomainUnavailable,
      },
    ];

    for (const { code, expected } of permanentCases) {
      it(`${code} → permanent_failure ${expected}`, async () => {
        const adapter = createCloudflareEmailNotificationTransport({
          emailBinding: createMockBinding({
            type: "throw",
            error: new CloudflareEmailProviderError(code, "provider detail"),
          }),
        });
        const result = await adapter.send(sampleInput());
        assert.equal(result.outcome, "permanent_failure");
        if (result.outcome === "permanent_failure") {
          assert.equal(result.errorCode, expected);
          assert.equal(result.errorMessage, undefined);
        }
      });
    }
  });

  describe("temporary_failure mapping", () => {
    const temporaryCases: Array<{
      code: string;
      expected: string;
    }> = [
      {
        code: "E_RATE_LIMIT_EXCEEDED",
        expected: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.rateLimitExceeded,
      },
      {
        code: "E_DAILY_LIMIT_EXCEEDED",
        expected: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.dailyLimitExceeded,
      },
      {
        code: "E_INTERNAL_SERVER_ERROR",
        expected: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.internalServerError,
      },
      {
        code: "E_DELIVERY_FAILED",
        expected: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.deliveryFailed,
      },
    ];

    for (const { code, expected } of temporaryCases) {
      it(`${code} → temporary_failure ${expected}`, async () => {
        const adapter = createCloudflareEmailNotificationTransport({
          emailBinding: createMockBinding({
            type: "throw",
            error: new CloudflareEmailProviderError(code),
          }),
        });
        const result = await adapter.send(sampleInput());
        assert.equal(result.outcome, "temporary_failure");
        if (result.outcome === "temporary_failure") {
          assert.equal(result.errorCode, expected);
          assert.equal(result.errorMessage, undefined);
        }
      });
    }
  });

  it("unknown Cloudflare code → ambiguous", async () => {
    const adapter = createCloudflareEmailNotificationTransport({
      emailBinding: createMockBinding({
        type: "throw",
        error: new CloudflareEmailProviderError("E_FUTURE_UNKNOWN_CODE"),
      }),
    });
    assert.deepEqual(await adapter.send(sampleInput()), { outcome: "ambiguous" });
  });

  it("throw without code → ambiguous", async () => {
    const binding: CloudflareEmailSendBinding = {
      async send() {
        throw new Error("network failure");
      },
    };
    const adapter = createCloudflareEmailNotificationTransport({
      emailBinding: binding,
    });
    assert.deepEqual(await adapter.send(sampleInput()), { outcome: "ambiguous" });
  });
});
