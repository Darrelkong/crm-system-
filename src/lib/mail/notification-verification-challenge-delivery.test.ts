import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CloudflareEmailProviderError,
  CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES,
  CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
  dispatchCloudflareEmailSendWithTimeout,
  NOTIFICATION_VERIFICATION_EMAIL_SEND_TIMEOUT_MS,
  type CloudflareEmailSendBinding,
  type CloudflareEmailSendRequest,
} from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import {
  createEmailNotificationVerificationChallengeSink,
  isVerificationChallengeDeliveryAmbiguous,
  isVerificationChallengeDeliveryFailure,
  NotificationVerificationChallengeDeliveryAmbiguousError,
} from "@/lib/mail/notification-verification-challenge-delivery";

function createBinding(
  behavior:
    | { type: "success"; messageId: string }
    | { type: "throw"; error: CloudflareEmailProviderError }
    | { type: "hang" },
): CloudflareEmailSendBinding {
  return {
    async send(request: CloudflareEmailSendRequest) {
      if (behavior.type === "hang") {
        return new Promise(() => {});
      }
      if (behavior.type === "throw") {
        throw behavior.error;
      }
      assert.equal(request.to, "staff@example.com");
      assert.ok(request.from.toString().includes(CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS));
      return { messageId: behavior.messageId };
    },
  };
}

describe("dispatchCloudflareEmailSendWithTimeout", () => {
  it("accepts successful send with messageId", async () => {
    const result = await dispatchCloudflareEmailSendWithTimeout(
      createBinding({ type: "success", messageId: "0101018f-msg-abc" }),
      {
        to: "staff@example.com",
        from: CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
        subject: "test",
        text: "code",
      },
    );
    assert.deepEqual(result, {
      outcome: "accepted",
      providerRequestId: "0101018f-msg-abc",
    });
  });

  it("maps explicit provider rejection to permanent failure", async () => {
    const result = await dispatchCloudflareEmailSendWithTimeout(
      createBinding({
        type: "throw",
        error: new CloudflareEmailProviderError("E_RECIPIENT_NOT_ALLOWED"),
      }),
      {
        to: "staff@example.com",
        from: CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
        subject: "test",
        text: "code",
      },
    );
    assert.equal(result.outcome, "permanent_failure");
    if (result.outcome === "permanent_failure") {
      assert.equal(
        result.errorCode,
        CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.recipientNotAllowed,
      );
    }
  });

  it("maps retryable provider rejection to temporary failure", async () => {
    const result = await dispatchCloudflareEmailSendWithTimeout(
      createBinding({
        type: "throw",
        error: new CloudflareEmailProviderError("E_RATE_LIMIT_EXCEEDED"),
      }),
      {
        to: "staff@example.com",
        from: CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
        subject: "test",
        text: "code",
      },
    );
    assert.equal(result.outcome, "temporary_failure");
    if (result.outcome === "temporary_failure") {
      assert.equal(
        result.errorCode,
        CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.rateLimitExceeded,
      );
    }
  });

  it("returns ambiguous when send never resolves before timeout", async () => {
    const result = await dispatchCloudflareEmailSendWithTimeout(
      createBinding({ type: "hang" }),
      {
        to: "staff@example.com",
        from: CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
        subject: "test",
        text: "code",
      },
      { timeoutMs: 25 },
    );
    assert.deepEqual(result, { outcome: "ambiguous" });
  });

  it("uses the frozen verification timeout constant by default", () => {
    assert.equal(NOTIFICATION_VERIFICATION_EMAIL_SEND_TIMEOUT_MS, 20_000);
  });
});

describe("createEmailNotificationVerificationChallengeSink", () => {
  it("returns providerRequestId on success", async () => {
    const sink = createEmailNotificationVerificationChallengeSink(
      createBinding({ type: "success", messageId: "0101018f-verify-1" }),
    );
    const result = await sink.deliverChallenge({
      notificationIdentityId: "identity-1",
      targetEmail: "staff@example.com",
      token: "ABCD1234",
      expiresAt: "2026-08-31T10:00:00.000Z",
    });
    assert.deepEqual(result, { providerRequestId: "0101018f-verify-1" });
  });

  it("throws ambiguous error when send times out", async () => {
    const sink = createEmailNotificationVerificationChallengeSink(
      {
        send() {
          return new Promise(() => {});
        },
      },
      { timeoutMs: 25 },
    );
    await assert.rejects(
      async () => {
        await sink.deliverChallenge({
          notificationIdentityId: "identity-1",
          targetEmail: "staff@example.com",
          token: "ABCD1234",
          expiresAt: "2026-08-31T10:00:00.000Z",
        });
      },
      (error: unknown) => {
        assert.ok(isVerificationChallengeDeliveryAmbiguous(error));
        assert.ok(
          error instanceof NotificationVerificationChallengeDeliveryAmbiguousError,
        );
        return true;
      },
    );
  });

  it("throws explicit delivery error for retryable provider failure", async () => {
    const sink = createEmailNotificationVerificationChallengeSink(
      createBinding({
        type: "throw",
        error: new CloudflareEmailProviderError("E_DELIVERY_FAILED"),
      }),
    );
    await assert.rejects(
      async () => {
        await sink.deliverChallenge({
          notificationIdentityId: "identity-1",
          targetEmail: "staff@example.com",
          token: "ABCD1234",
          expiresAt: "2026-08-31T10:00:00.000Z",
        });
      },
      (error: unknown) => {
        assert.ok(isVerificationChallengeDeliveryFailure(error));
        if (error instanceof Error) {
          assert.equal(error.name, "NotificationVerificationChallengeDeliveryError");
        }
        return true;
      },
    );
  });
});
