import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEmailNotificationVerificationChallengeSink,
  isVerificationChallengeDeliveryAmbiguous,
  isVerificationChallengeDeliveryFailure,
  NotificationVerificationChallengeDeliveryAmbiguousError,
  VERIFICATION_PRE_PROVIDER_FAILURE_CODE,
} from "@/lib/mail/notification-verification-challenge-delivery";
import type { CloudflareEmailServiceRestVerificationTransportConfig } from "@/lib/mail/cloudflare-email-service-rest-verification-transport";

const RECIPIENT = "staff@example.com";

function restConfig(
  fetchFn: CloudflareEmailServiceRestVerificationTransportConfig["fetchFn"],
  options?: { timeoutMs?: number },
): CloudflareEmailServiceRestVerificationTransportConfig {
  return {
    accountId: "test-account-id",
    apiToken: "test-api-token",
    fetchFn,
    timeoutMs: options?.timeoutMs,
  };
}

describe("createEmailNotificationVerificationChallengeSink", () => {
  it("returns providerRequestId on REST success", async () => {
    const sink = createEmailNotificationVerificationChallengeSink(
      restConfig(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: {
              message_id: "0101018f-verify-1",
              delivered: [RECIPIENT],
              queued: [],
              permanent_bounces: [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const result = await sink.deliverChallenge({
      notificationIdentityId: "identity-1",
      targetEmail: RECIPIENT,
      token: "ABCD1234",
      expiresAt: "2026-08-31T10:00:00.000Z",
    });
    assert.deepEqual(result, { providerRequestId: "0101018f-verify-1" });
  });

  it("throws ambiguous error when REST fetch aborts", async () => {
    const sink = createEmailNotificationVerificationChallengeSink(
      restConfig(async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        }), { timeoutMs: 25 }),
    );
    await assert.rejects(
      async () => {
        await sink.deliverChallenge({
          notificationIdentityId: "identity-1",
          targetEmail: RECIPIENT,
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

  it("throws explicit delivery error for permanent REST failure", async () => {
    const sink = createEmailNotificationVerificationChallengeSink(
      restConfig(async () =>
        new Response(JSON.stringify({ success: false, result: null }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await assert.rejects(
      async () => {
        await sink.deliverChallenge({
          notificationIdentityId: "identity-1",
          targetEmail: RECIPIENT,
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

  it("fails before provider dispatch when email content cannot be built", async () => {
    let fetchCalled = false;
    const sink = createEmailNotificationVerificationChallengeSink({
      ...restConfig(async () => {
        fetchCalled = true;
        return new Response();
      }),
    });
    await assert.rejects(
      async () => {
        await sink.deliverChallenge(
          undefined as never,
        );
      },
      (error: unknown) => {
        assert.ok(isVerificationChallengeDeliveryFailure(error));
        assert.equal(
          error instanceof Error ? error.name : "",
          "NotificationVerificationChallengeDeliveryError",
        );
        assert.equal(
          error instanceof Error &&
            "errorCode" in error &&
            typeof error.errorCode === "string"
            ? error.errorCode
            : null,
          VERIFICATION_PRE_PROVIDER_FAILURE_CODE,
        );
        return true;
      },
    );
    assert.equal(fetchCalled, false);
  });
});
