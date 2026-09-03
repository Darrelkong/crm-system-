import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bytesToBase64,
  buildCloudflareEmailOutboundSendRequestForTest,
  buildCloudflareEmailOutboundProviderSendRequest,
  CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES,
  createCloudflareEmailOutboundTransport,
  type CloudflareEmailOutboundSendRequest,
  type CloudflareEmailOutboundProviderSendRequest,
} from "@/lib/mail/cloudflare-email-outbound-transport-adapter";
import {
  CloudflareEmailProviderError,
  type CloudflareEmailSendBinding,
} from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import { decodeOutboundDispatchDiagnostic } from "@/lib/mail/outbound-dispatch-diagnostics";
import {
  CLOUDFLARE_EMAIL_OUTBOUND_PROVIDER_ID,
  isMailOutboundTransportEnabled,
  MAIL_OUTBOUND_TRANSPORT_ENABLED_VAR,
  MAIL_OUTBOUND_TRANSPORT_MODE_VAR,
  OUTBOUND_TRANSPORT_DRY_RUN_MESSAGE_PREFIX,
  OUTBOUND_TRANSPORT_DRY_RUN_REQUEST_PREFIX,
  resolveMailOutboundTransportMode,
} from "@/lib/mail/outbound-transport-constants";
import { resolveOutboundMailTransportAdapter } from "@/lib/mail/outbound-transport-wiring";
import type { NormalizedOutboundSubmission } from "@/lib/mail/transport/mail-transport-adapter";

function sampleSubmission(
  overrides?: Partial<NormalizedOutboundSubmission>,
): NormalizedOutboundSubmission {
  return {
    sendOperationId: "send-op-1",
    transportAttemptId: "attempt-1",
    outboundRevisionId: "revision-1",
    rfcMessageId: "<abc123@echfronthk.com>",
    fromAddress: "sales@echfronthk.com",
    fromDisplayName: "Sales Team",
    subject: "Quarterly update",
    bodyText: "Hello team",
    bodyHtmlSanitized: "<p>Hello team</p>",
    signatureBodyText: "Best regards",
    signatureBodyHtmlSanitized: "<p>Best regards</p>",
    signatureAssets: [],
    recipients: [
      {
        type: "to",
        address: "client@example.com",
        displayName: "Client",
      },
      {
        type: "cc",
        address: "manager@example.com",
        displayName: null,
      },
    ],
    attachments: [
      {
        revisionAttachmentId: "rev-att-1",
        storedFileId: "file-1",
        contentHash: "a".repeat(64),
        displayFilename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4096,
        sortOrder: 0,
        deliveryMode: "direct_attachment",
        secureExpiryDays: null,
      },
    ],
    inReplyTo: null,
    referencesHeader: null,
    ...overrides,
  };
}

function bytesWithPrefix(size: number, prefix: number[]): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(prefix);
  return bytes;
}

describe("cloudflare email outbound transport adapter", () => {
  it("freezes providerId as cloudflare-email-sending-outbound", () => {
    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "dry_run",
    });
    assert.equal(adapter.providerId, CLOUDFLARE_EMAIL_OUTBOUND_PROVIDER_ID);
  });

  it("converts queue submission into provider payload with RFC identity and attachments", async () => {
    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "dry_run",
    });
    const submission = sampleSubmission();

    const result = await adapter.submitOutbound(submission);
    assert.equal(result.outcome, "accepted");
    if (result.outcome === "accepted") {
      assert.match(result.providerRequestId, /^dry-run-req-/);
      assert.match(
        result.providerMessageId,
        /^<dry-run-attempt-1@echfronthk\.com>$/,
      );
    }

    assert.equal(adapter.capture.callCount, 1);
    const captured = adapter.capture.calls[0];
    assert.ok(captured);
    assert.equal(captured.request.to[0], "Client <client@example.com>");
    assert.equal(captured.request.cc?.[0], "manager@example.com");
    assert.deepEqual(captured.request.from, {
      email: "sales@echfronthk.com",
      name: "Sales Team",
    });
    assert.equal(captured.request.subject, "Quarterly update");
    assert.equal(captured.request.text, "Hello team\n\nBest regards");
    assert.equal(
      captured.request.html,
      "<p>Hello team</p><br><br><p>Best regards</p>",
    );
    assert.equal(captured.request.headers?.["Message-ID"], undefined);
    assert.equal(captured.request.attachments?.length, 1);
    assert.equal(captured.request.attachments?.[0]?.filename, "report.pdf");
    assert.equal(captured.request.attachments?.[0]?.contentHash, "a".repeat(64));
    assert.equal(
      captured.request.attachments?.[0]?.storageKey,
      "mail/outbound-attachments/file-1",
    );
    assert.equal(captured.request.attachments?.[0]?.content, undefined);
  });

  it("emits attachment disposition and exact binary content for common MIME types", async () => {
    const cases = [
      {
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        bytes: bytesWithPrefix(226_773, [0xff, 0xd8, 0xff, 0x01]),
      },
      {
        filename: "photo.png",
        mimeType: "image/png",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      },
      {
        filename: "document.pdf",
        mimeType: "application/pdf",
        bytes: new TextEncoder().encode("%PDF-1.7"),
      },
    ] as const;

    for (const testCase of cases) {
      let providerRequest: unknown = null;
      const adapter = createCloudflareEmailOutboundTransport({
        transportMode: "production",
        emailBinding: {
          async send(request) {
            providerRequest = request;
            return { messageId: `${testCase.filename}-accepted` };
          },
        },
        attachmentReader: {
          async read() {
            return testCase.bytes;
          },
        },
      });

      const result = await adapter.submitOutbound(
        sampleSubmission({
          attachments: [
            {
              revisionAttachmentId: `revision-${testCase.filename}`,
              storedFileId: `file-${testCase.filename}`,
              contentHash: "a".repeat(64),
              displayFilename: testCase.filename,
              mimeType: testCase.mimeType,
              sizeBytes: testCase.bytes.byteLength,
              sortOrder: 0,
              deliveryMode: "direct_attachment",
              secureExpiryDays: null,
            },
          ],
        }),
      );

      assert.equal(result.outcome, "accepted");
      const capturedProviderRequest =
        providerRequest as CloudflareEmailOutboundProviderSendRequest;
      const providerAttachment = capturedProviderRequest.attachments?.[0];
      assert.deepEqual(providerAttachment, {
        filename: testCase.filename,
        type: testCase.mimeType,
        content: testCase.bytes,
        disposition: "attachment",
      });
      const binaryContent = providerAttachment?.content;
      assert.ok(binaryContent instanceof Uint8Array);
      if (binaryContent instanceof Uint8Array) {
        assert.equal(binaryContent.byteLength, testCase.bytes.byteLength);
        assert.equal(
          Buffer.compare(
            Buffer.from(binaryContent.slice(0, 3)),
            Buffer.from(testCase.bytes.slice(0, 3)),
          ),
          0,
        );
      }
    }
  });

  it("keeps the Base64 helper byte-for-byte compatible", () => {
    const source = bytesWithPrefix(226_773, [0xff, 0xd8, 0xff, 0x01]);
    const encoded = bytesToBase64(source);
    const decoded = new Uint8Array(Buffer.from(encoded, "base64"));
    assert.equal(decoded.byteLength, source.byteLength);
    assert.equal(
      Buffer.compare(Buffer.from(decoded), Buffer.from(source)),
      0,
    );
  });

  it("omits attachments for no-attachment messages", async () => {
    let providerRequest: unknown = null;
    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "production",
      emailBinding: {
        async send(request) {
          providerRequest = request;
          return { messageId: "no-attachment-accepted" };
        },
      },
      attachmentReader: { async read() { return new Uint8Array([1]); } },
    });

    const result = await adapter.submitOutbound(
      sampleSubmission({ attachments: [] }),
    );
    assert.equal(result.outcome, "accepted");
    const capturedProviderRequest =
      providerRequest as CloudflareEmailOutboundProviderSendRequest;
    assert.equal(capturedProviderRequest.attachments, undefined);
  });

  it("test helper matches production request builder", () => {
    const submission = sampleSubmission();
    const body = buildCloudflareEmailOutboundSendRequestForTest(submission);
    assert.equal(body.to[0], "Client <client@example.com>");
    assert.equal(body.headers?.["Message-ID"], undefined);
  });

  it("emits In-Reply-To and References for reply submissions without Message-ID", () => {
    const submission = sampleSubmission({
      inReplyTo: "<parent@example.com>",
      referencesHeader: "<parent@example.com>",
    });
    const body = buildCloudflareEmailOutboundSendRequestForTest(submission);
    assert.equal(body.headers?.["In-Reply-To"], "<parent@example.com>");
    assert.equal(body.headers?.References, "<parent@example.com>");
    assert.equal(body.headers?.["Message-ID"], undefined);
  });

  it("dry-run mode never invokes Cloudflare binding", async () => {
    let invoked = false;
    const binding: CloudflareEmailSendBinding = {
      async send() {
        invoked = true;
        return { messageId: "should-not-be-used" };
      },
    };

    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "dry_run",
      emailBinding: binding,
    });
    await adapter.submitOutbound(sampleSubmission());
    assert.equal(invoked, false);
  });

  it("maps provider permanent failures when transport is enabled", async () => {
    const binding: CloudflareEmailSendBinding = {
      async send() {
        throw new CloudflareEmailProviderError("E_SENDER_NOT_VERIFIED");
      },
    };

    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "production",
      emailBinding: binding,
      attachmentReader: {
        async read() {
          return new Uint8Array([1, 2, 3]);
        },
      },
    });

    const result = await adapter.submitOutbound(sampleSubmission());
    assert.equal(result.outcome, "permanent_failure");
    if (result.outcome === "permanent_failure") {
      assert.equal(
        result.errorCode,
        CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.senderNotVerified,
      );
    }
  });

  it("maps provider temporary failures when transport is enabled", async () => {
    const binding: CloudflareEmailSendBinding = {
      async send() {
        throw new CloudflareEmailProviderError("E_RATE_LIMIT_EXCEEDED");
      },
    };

    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "production",
      emailBinding: binding,
      attachmentReader: {
        async read() {
          return new Uint8Array([1]);
        },
      },
    });

    const result = await adapter.submitOutbound(sampleSubmission());
    assert.equal(result.outcome, "temporary_failure");
    if (result.outcome === "temporary_failure") {
      assert.equal(
        result.errorCode,
        CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.rateLimitExceeded,
      );
    }
  });

  it("captures an HTTP 4xx as a definitive provider rejection", async () => {
    const binding: CloudflareEmailSendBinding = {
      async send() {
        throw new CloudflareEmailProviderError(
          "E_REQUEST_REJECTED",
          "recipient rejected",
          {
            status: 422,
            requestId: "req-4xx",
            responseContentType: "application/json",
          },
        );
      },
    };
    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "production",
      emailBinding: binding,
      attachmentReader: { async read() { return new Uint8Array([1]); } },
    });

    const result = await adapter.submitOutbound(sampleSubmission());
    assert.equal(result.outcome, "permanent_failure");
    assert.equal(result.diagnostic?.failureClass, "http_rejection");
    assert.equal(result.diagnostic?.providerHttpStatus, 422);
    assert.equal(result.diagnostic?.providerCorrelationId, "req-4xx");
    assert.equal(result.diagnostic?.providerResponseReceived, true);
  });

  it("keeps an HTTP 5xx ambiguous because acceptance is unproven", async () => {
    const binding: CloudflareEmailSendBinding = {
      async send() {
        throw new CloudflareEmailProviderError(
          "E_INTERNAL_SERVER_ERROR",
          "provider internal failure",
          { status: 503, rayId: "ray-5xx" },
        );
      },
    };
    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "production",
      emailBinding: binding,
      attachmentReader: { async read() { return new Uint8Array([1]); } },
    });

    const result = await adapter.submitOutbound(sampleSubmission());
    assert.equal(result.outcome, "ambiguous");
    assert.equal(result.diagnostic?.failureClass, "provider_5xx");
    assert.equal(result.diagnostic?.providerHttpStatus, 503);
    assert.equal(result.diagnostic?.providerCorrelationId, "ray-5xx");
    assert.equal(result.diagnostic?.providerAcceptance, "unknown");
  });

  it("classifies timeout, abort, reset, and unknown internal failures safely", async () => {
    const cases = [
      { name: "TimeoutError", code: "ETIMEDOUT", expected: "timeout" },
      { name: "AbortError", code: "ABORT_ERR", expected: "abort" },
      { name: "Error", code: "ECONNRESET", expected: "network_reset" },
      { name: "Error", code: "E_UNKNOWN_PROVIDER", expected: "unknown_provider_error" },
    ] as const;

    for (const testCase of cases) {
      const binding: CloudflareEmailSendBinding = {
        async send() {
          const error = new Error("safe provider failure");
          error.name = testCase.name;
          Object.assign(error, { code: testCase.code });
          throw error;
        },
      };
      const adapter = createCloudflareEmailOutboundTransport({
        transportMode: "production",
        emailBinding: binding,
        attachmentReader: { async read() { return new Uint8Array([1]); } },
      });
      const result = await adapter.submitOutbound(sampleSubmission());
      assert.equal(result.outcome, "ambiguous");
      assert.equal(result.diagnostic?.failureClass, testCase.expected);
      assert.equal(result.diagnostic?.providerAcceptance, "unknown");
    }
  });

  it("maps a standard Error with E_VALIDATION_ERROR to permanent failure", async () => {
    const binding: CloudflareEmailSendBinding = {
      async send() {
        const error = new Error(
          "disposition should be 'inline' or 'attachment'",
        );
        Object.assign(error, { code: "E_VALIDATION_ERROR" });
        throw error;
      },
    };
    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "production",
      emailBinding: binding,
      attachmentReader: { async read() { return new Uint8Array([1]); } },
    });

    const result = await adapter.submitOutbound(sampleSubmission());
    assert.equal(result.outcome, "permanent_failure");
    if (result.outcome === "permanent_failure") {
      assert.equal(
        result.errorCode,
        CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.validation,
      );
    }
    assert.equal(result.diagnostic?.providerErrorCode, "E_VALIDATION_ERROR");
    assert.equal(result.diagnostic?.providerAcceptance, "not_confirmed");
  });

  it("turns a malformed provider response into an ambiguous result", async () => {
    const binding: CloudflareEmailSendBinding = {
      async send() {
        return { messageId: "" };
      },
    };
    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "production",
      emailBinding: binding,
      attachmentReader: { async read() { return new Uint8Array([1]); } },
    });

    const result = await adapter.submitOutbound(sampleSubmission());
    assert.equal(result.outcome, "ambiguous");
    assert.equal(result.diagnostic?.failureClass, "response_parse");
    assert.equal(result.diagnostic?.providerResponseReceived, true);
    assert.equal(
      decodeOutboundDispatchDiagnostic(
        `outbound-dispatch-diagnostic:v1:${JSON.stringify(result.diagnostic)}`,
      )?.failureClass,
      "response_parse",
    );
  });

  it("returns accepted provider ids when transport is enabled", async () => {
    const binding: CloudflareEmailSendBinding = {
      async send() {
        return { messageId: "0101018f-outbound-msg" };
      },
    };

    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "production",
      emailBinding: binding,
      attachmentReader: {
        async read() {
          return new Uint8Array([1]);
        },
      },
    });

    const result = await adapter.submitOutbound(sampleSubmission());
    assert.deepEqual(result, {
      outcome: "accepted",
      providerRequestId: "0101018f-outbound-msg",
      providerMessageId: "0101018f-outbound-msg",
    });
  });

  it("passes bcc recipients and omits Reply-To when same as From", () => {
    const submission = sampleSubmission({
      recipients: [
        { type: "to", address: "client@example.com", displayName: null },
        { type: "bcc", address: "hidden@example.com", displayName: null },
      ],
    });
    const body = buildCloudflareEmailOutboundSendRequestForTest(submission);
    assert.equal(body.bcc?.[0], "hidden@example.com");
    assert.equal(body.headers?.["Reply-To"], undefined);
    assert.equal(body.headers?.["Message-ID"], undefined);
  });

  it("rejects oversize payloads before binding call with zero provider invocations", async () => {
    let invoked = false;
    const binding: CloudflareEmailSendBinding = {
      async send() {
        invoked = true;
        return { messageId: "should-not-run" };
      },
    };
    const adapter = createCloudflareEmailOutboundTransport({
      transportMode: "production",
      emailBinding: binding,
      attachmentReader: {
        async read() {
          return new Uint8Array([1]);
        },
      },
    });
    const submission = sampleSubmission({
      bodyText: "z".repeat(4_200_000),
      attachments: [
        {
          revisionAttachmentId: "rev-att-2",
          storedFileId: "file-2",
          contentHash: "b".repeat(64),
          displayFilename: "big.bin",
          mimeType: "application/octet-stream",
          sizeBytes: 1_200_000,
          sortOrder: 0,
          deliveryMode: "direct_attachment",
          secureExpiryDays: null,
        },
      ],
    });
    const result = await adapter.submitOutbound(submission);
    assert.equal(result.outcome, "permanent_failure");
    if (result.outcome === "permanent_failure") {
      assert.equal(result.errorCode, "MESSAGE_TOO_LARGE_FOR_EMAIL_PROVIDER");
    }
    assert.equal(invoked, false);
    assert.equal(adapter.capture.callCount, 1);
  });

  it("filters unsupported custom dangerous headers", () => {
    const submission = sampleSubmission({
      inReplyTo: "<parent@example.com>",
    });
    const request = buildCloudflareEmailOutboundSendRequestForTest(submission);
    request.headers = {
      "In-Reply-To": "<parent@example.com>",
      "Message-ID": "<custom@evil.com>",
      References: "<parent@example.com>",
    };
    const provider = buildCloudflareEmailOutboundProviderSendRequest({ request });
    assert.equal(provider.headers?.["Message-ID"], undefined);
    assert.equal(provider.headers?.["In-Reply-To"], "<parent@example.com>");
  });
});

describe("outbound transport wiring", () => {
  it("defaults transport mode to disabled", () => {
    assert.equal(resolveMailOutboundTransportMode({}), "disabled");
    assert.equal(isMailOutboundTransportEnabled({}), false);
    assert.equal(
      isMailOutboundTransportEnabled({
        [MAIL_OUTBOUND_TRANSPORT_ENABLED_VAR]: "false",
      }),
      false,
    );
    assert.equal(
      isMailOutboundTransportEnabled({
        [MAIL_OUTBOUND_TRANSPORT_ENABLED_VAR]: "true",
      }),
      true,
    );
  });

  it("resolves dry-run adapter when mode is dry_run", async () => {
    const adapter = resolveOutboundMailTransportAdapter({
      env: { [MAIL_OUTBOUND_TRANSPORT_MODE_VAR]: "dry_run" },
    });
    const result = await adapter.submitOutbound(sampleSubmission());
    assert.equal(result.outcome, "accepted");
    if (result.outcome === "accepted") {
      assert.match(
        result.providerRequestId,
        new RegExp(`^${OUTBOUND_TRANSPORT_DRY_RUN_REQUEST_PREFIX}`),
      );
      assert.match(
        result.providerMessageId,
        /^<dry-run-/,
      );
    }
  });

  it("blocks provider submission when mode is disabled", async () => {
    const adapter = resolveOutboundMailTransportAdapter({ env: {} });
    await assert.rejects(
      () => adapter.submitOutbound(sampleSubmission()),
      /does not permit provider submission/,
    );
  });
});

describe("payload integrity", () => {
  it("preserves attachment stream references separately from optional bytes", () => {
    const submission = sampleSubmission();
    const request: CloudflareEmailOutboundSendRequest =
      buildCloudflareEmailOutboundSendRequestForTest(submission, [
        {
          revisionAttachmentId: "rev-att-1",
          storedFileId: "file-1",
          contentHash: "a".repeat(64),
          displayFilename: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4096,
          storageProvider: "r2",
          storageBucket: "crm-attachments",
          storageKey: "mail/outbound-attachments/abc",
        },
      ]);

    assert.equal(request.attachments?.[0]?.storageKey, "mail/outbound-attachments/abc");
    assert.equal(request.attachments?.[0]?.content, undefined);
  });
});
