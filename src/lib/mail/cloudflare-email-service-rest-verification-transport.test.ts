import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES,
  CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
} from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import {
  buildCloudflareEmailServiceRestSendUrl,
  buildCloudflareEmailServiceRestVerificationRequestBody,
  CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID_ENV,
  CLOUDFLARE_EMAIL_SENDING_API_TOKEN_ENV,
  CLOUDFLARE_EMAIL_SERVICE_REST_ERROR_CODES,
  dispatchCloudflareEmailServiceRestVerificationSend,
  NOTIFICATION_VERIFICATION_EMAIL_REST_SEND_TIMEOUT_MS,
  resolveCloudflareEmailServiceRestVerificationTransportConfig,
  type CloudflareEmailServiceRestVerificationTransportConfig,
} from "@/lib/mail/cloudflare-email-service-rest-verification-transport";
import {
  createEmailNotificationVerificationChallengeSink,
  isVerificationChallengeDeliveryAmbiguous,
  isVerificationChallengeDeliveryFailure,
  NotificationVerificationChallengeDeliveryAmbiguousError,
} from "@/lib/mail/notification-verification-challenge-delivery";

const RECIPIENT = "staff@example.com";
const ACCOUNT_ID = "test-account-id";
const API_TOKEN = "test-api-token";

function restConfig(
  fetchFn: CloudflareEmailServiceRestVerificationTransportConfig["fetchFn"],
  options?: { timeoutMs?: number; apiToken?: string },
): CloudflareEmailServiceRestVerificationTransportConfig {
  return {
    accountId: ACCOUNT_ID,
    apiToken: options?.apiToken ?? API_TOKEN,
    fetchFn,
    timeoutMs: options?.timeoutMs,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  init?: ResponseInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

function successPayload(input: {
  messageId: string;
  delivered?: string[];
  queued?: string[];
  permanent_bounces?: string[];
}) {
  return {
    success: true,
    errors: [],
    messages: [],
    result: {
      message_id: input.messageId,
      delivered: input.delivered ?? [],
      queued: input.queued ?? [],
      permanent_bounces: input.permanent_bounces ?? [],
    },
  };
}

describe("dispatchCloudflareEmailServiceRestVerificationSend", () => {
  it("accepts delivered success with message_id", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async (url, init) => {
        assert.equal(
          url,
          buildCloudflareEmailServiceRestSendUrl(ACCOUNT_ID),
        );
        assert.equal((init?.method ?? "GET").toUpperCase(), "POST");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("Authorization"), `Bearer ${API_TOKEN}`);
        assert.equal(headers.get("Content-Type"), "application/json");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.to, RECIPIENT);
        assert.equal(body.from.address, CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS);
        return jsonResponse(200, successPayload({
          messageId: "0101018f-rest-delivered",
          delivered: [RECIPIENT],
        }));
      }),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.deepEqual(result, {
      outcome: "accepted",
      providerRequestId: "0101018f-rest-delivered",
    });
  });

  it("accepts queued success with message_id", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async () =>
        jsonResponse(
          200,
          successPayload({
            messageId: "0101018f-rest-queued",
            queued: [RECIPIENT],
          }),
        ),
      ),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.deepEqual(result, {
      outcome: "accepted",
      providerRequestId: "0101018f-rest-queued",
    });
  });

  it("maps permanent bounce to permanent failure", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async () =>
        jsonResponse(
          200,
          successPayload({
            messageId: "0101018f-rest-bounce",
            permanent_bounces: [RECIPIENT],
          }),
        ),
      ),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.equal(result.outcome, "permanent_failure");
    if (result.outcome === "permanent_failure") {
      assert.equal(
        result.errorCode,
        CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.recipientSuppressed,
      );
    }
  });

  it("maps HTTP 401 to explicit auth/config permanent failure", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async () =>
        jsonResponse(401, {
          success: false,
          errors: [{ code: 1000, message: "Invalid API token" }],
          result: null,
        }),
      ),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.equal(result.outcome, "permanent_failure");
    if (result.outcome === "permanent_failure") {
      assert.equal(
        result.errorCode,
        CLOUDFLARE_EMAIL_SERVICE_REST_ERROR_CODES.authConfig,
      );
    }
  });

  it("maps HTTP 403 to explicit auth/config permanent failure", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async () => jsonResponse(403, { success: false, result: null })),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.equal(result.outcome, "permanent_failure");
  });

  it("maps HTTP 429 to temporary failure without unsafe retry semantics in adapter", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async () => jsonResponse(429, { success: false, result: null })),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.equal(result.outcome, "temporary_failure");
    if (result.outcome === "temporary_failure") {
      assert.equal(
        result.errorCode,
        CLOUDFLARE_EMAIL_SERVICE_REST_ERROR_CODES.rateLimitExceeded,
      );
    }
  });

  it("maps HTTP 5xx to ambiguous outcome", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async () => jsonResponse(503, { success: false, result: null })),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.deepEqual(result, { outcome: "ambiguous" });
  });

  it("maps fetch AbortError to ambiguous outcome", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
        { timeoutMs: 25 },
      ),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.deepEqual(result, { outcome: "ambiguous" });
  });

  it("aborts never-resolving fetch at bounded timeout", async () => {
    const startedAt = Date.now();
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
        { timeoutMs: 50 },
      ),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.deepEqual(result, { outcome: "ambiguous" });
    assert.ok(Date.now() - startedAt >= 45);
    assert.ok(Date.now() - startedAt < 250);
  });

  it("maps malformed JSON to ambiguous outcome", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async () => new Response("{", { status: 200 })),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.deepEqual(result, { outcome: "ambiguous" });
  });

  it("maps malformed Cloudflare response to ambiguous outcome", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async () => jsonResponse(200, { ok: true })),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.deepEqual(result, { outcome: "ambiguous" });
  });

  it("maps missing message_id to ambiguous outcome", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async () =>
        jsonResponse(200, {
          success: true,
          result: { delivered: [RECIPIENT], queued: [], permanent_bounces: [] },
        }),
      ),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.deepEqual(result, { outcome: "ambiguous" });
  });

  it("maps recipient absent from delivery arrays to ambiguous outcome", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async () =>
        jsonResponse(
          200,
          successPayload({
            messageId: "0101018f-rest-unknown",
            delivered: [],
            queued: [],
            permanent_bounces: [],
          }),
        ),
      ),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.deepEqual(result, { outcome: "ambiguous" });
  });

  it("fails closed when api token is missing", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      { accountId: ACCOUNT_ID, apiToken: "   " },
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.equal(result.outcome, "permanent_failure");
    if (result.outcome === "permanent_failure") {
      assert.equal(
        result.errorCode,
        CLOUDFLARE_EMAIL_SERVICE_REST_ERROR_CODES.transportNotConfigured,
      );
    }
  });

  it("fails closed when account id is missing", async () => {
    const result = await dispatchCloudflareEmailServiceRestVerificationSend(
      { accountId: "", apiToken: API_TOKEN },
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.equal(result.outcome, "permanent_failure");
  });

  it("never logs api token in request construction", async () => {
    let capturedAuthorization: string | null = null;
    await dispatchCloudflareEmailServiceRestVerificationSend(
      restConfig(async (_url, init) => {
        capturedAuthorization = new Headers(init?.headers).get("Authorization");
        return jsonResponse(
          200,
          successPayload({ messageId: "0101018f-rest-safe", delivered: [RECIPIENT] }),
        );
      }, { apiToken: "super-secret-token-value" }),
      { to: RECIPIENT, subject: "Verify", text: "12345678" },
    );
    assert.equal(capturedAuthorization, "Bearer super-secret-token-value");
  });

  it("uses the frozen REST timeout constant by default", () => {
    assert.equal(NOTIFICATION_VERIFICATION_EMAIL_REST_SEND_TIMEOUT_MS, 20_000);
  });

  it("builds canonical REST request body", () => {
    const body = buildCloudflareEmailServiceRestVerificationRequestBody({
      to: RECIPIENT,
      subject: "Verify",
      text: "12345678",
    });
    assert.equal(body.to, RECIPIENT);
    assert.deepEqual(body.from, {
      address: CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
      name: "ECHFRONT CRM Mail",
    });
  });

  it("resolveCloudflareEmailServiceRestVerificationTransportConfig fails closed when missing", () => {
    assert.throws(
      () => resolveCloudflareEmailServiceRestVerificationTransportConfig({}),
      /not configured/,
    );
    assert.throws(
      () =>
        resolveCloudflareEmailServiceRestVerificationTransportConfig({
          [CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID_ENV]: ACCOUNT_ID,
        }),
      /not configured/,
    );
    assert.throws(
      () =>
        resolveCloudflareEmailServiceRestVerificationTransportConfig({
          [CLOUDFLARE_EMAIL_SENDING_API_TOKEN_ENV]: API_TOKEN,
        }),
      /not configured/,
    );
  });
});

describe("createEmailNotificationVerificationChallengeSink REST wiring", () => {
  it("returns providerRequestId on REST delivered success", async () => {
    const sink = createEmailNotificationVerificationChallengeSink(
      restConfig(async () =>
        jsonResponse(
          200,
          successPayload({
            messageId: "0101018f-verify-rest",
            delivered: [RECIPIENT],
          }),
        ),
      ),
    );
    const result = await sink.deliverChallenge({
      notificationIdentityId: "identity-1",
      targetEmail: RECIPIENT,
      token: "ABCD1234",
      expiresAt: "2026-08-31T10:00:00.000Z",
    });
    assert.deepEqual(result, { providerRequestId: "0101018f-verify-rest" });
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

  it("throws explicit delivery error for retryable REST failure", async () => {
    const sink = createEmailNotificationVerificationChallengeSink(
      restConfig(async () => jsonResponse(429, { success: false, result: null })),
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
        return true;
      },
    );
  });
});
