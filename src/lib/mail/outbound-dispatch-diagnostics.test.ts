import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOutboundDispatchDiagnostic,
  buildOutboundDispatchDiagnosticFromError,
  decodeOutboundDispatchDiagnostic,
  encodeOutboundDispatchDiagnostic,
} from "@/lib/mail/outbound-dispatch-diagnostics";
import type { NormalizedOutboundSubmission } from "@/lib/mail/transport/mail-transport-adapter";

function submission(): NormalizedOutboundSubmission {
  return {
    sendOperationId: "send-safe-reference",
    transportAttemptId: "attempt-safe-reference",
    outboundRevisionId: "revision-safe-reference",
    authorizationMode: "admin_direct",
    rfcMessageId: "<safe-reference@echfronthk.com>",
    fromAddress: "sender@echfronthk.com",
    fromDisplayName: "Sender",
    subject: "Subject",
    bodyText: "FULL_MESSAGE_BODY_SENTINEL",
    bodyHtmlSanitized: null,
    signatureBodyText: null,
    signatureBodyHtmlSanitized: null,
    signatureAssets: [],
    recipients: [{ type: "to", address: "recipient@example.com", displayName: null }],
    attachments: [
      {
        revisionAttachmentId: "attachment-1",
        storedFileId: "file-1",
        contentHash: "a".repeat(64),
        displayFilename: "report.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 2_700_000,
        sortOrder: 0,
        deliveryMode: "direct_attachment",
        secureExpiryDays: null,
      },
    ],
    inReplyTo: null,
    referencesHeader: null,
  };
}

describe("outbound dispatch diagnostics", () => {
  it("captures safe provider metadata and attachment totals", () => {
    const diagnostic = buildOutboundDispatchDiagnostic({
      submission: submission(),
      provider: "cloudflare-email-sending-outbound",
      elapsedDispatchMs: 37.4,
      providerResponseReceived: true,
      providerAcceptance: "unknown",
      providerHttpStatus: 503,
      providerErrorCategory: "internal",
      providerErrorCode: "E_INTERNAL_SERVER_ERROR",
      providerCorrelationId: "ray-123",
      responseContentType: "application/json",
      safeProviderMessage: "Authorization: SECRET_SENTINEL",
      failureClass: "provider_5xx",
    });

    assert.equal(diagnostic.sendOperationId, "send-safe-reference");
    assert.equal(diagnostic.attemptId, "attempt-safe-reference");
    assert.equal(diagnostic.providerHttpStatus, 503);
    assert.equal(diagnostic.providerCorrelationId, "ray-123");
    assert.equal(diagnostic.safeProviderMessage, "Provider error details redacted");
    assert.equal(diagnostic.attachmentCount, 1);
    assert.equal(diagnostic.attachmentBytes, 2_700_000);
    assert.equal(diagnostic.mimeEnvelopeSizeBytes, null);
    assert.equal(diagnostic.elapsedDispatchMs, 37);
  });

  it("classifies transport exceptions without making them retry-safe", () => {
    const timeout = Object.assign(new Error("timeout"), {
      name: "TimeoutError",
      code: "ETIMEDOUT",
    });
    const diagnostic = buildOutboundDispatchDiagnosticFromError({
      submission: submission(),
      provider: "cloudflare-email-sending-outbound",
      error: timeout,
      elapsedDispatchMs: 20_000,
    });
    assert.equal(diagnostic.failureClass, "timeout");
    assert.equal(diagnostic.providerAcceptance, "unknown");
    assert.equal(diagnostic.providerResponseReceived, false);
  });

  it("round-trips the bounded persisted envelope without sensitive payloads", () => {
    const encoded = encodeOutboundDispatchDiagnostic(
      buildOutboundDispatchDiagnostic({
        submission: submission(),
        provider: "cloudflare-email-sending-outbound",
        elapsedDispatchMs: 12,
        providerResponseReceived: false,
        providerAcceptance: "unknown",
        providerErrorCode: "E_UNKNOWN",
        safeProviderMessage:
          "body=FULL_MESSAGE_BODY_SENTINEL attachment=ATTACHMENT_BYTES_SENTINEL token=API_TOKEN_SENTINEL",
        failureClass: "unknown_provider_error",
      }),
    );
    assert.ok(encoded.startsWith("outbound-dispatch-diagnostic:v1:"));
    assert.doesNotMatch(encoded, /FULL_MESSAGE_BODY_SENTINEL/);
    assert.doesNotMatch(encoded, /ATTACHMENT_BYTES_SENTINEL/);
    assert.doesNotMatch(encoded, /API_TOKEN_SENTINEL/);
    assert.doesNotMatch(encoded, /SECRET_SENTINEL/);
    assert.doesNotMatch(encoded, /OTP_SECRET_SENTINEL/);
    assert.doesNotMatch(encoded, /CREDENTIAL_SENTINEL/);
    assert.deepEqual(decodeOutboundDispatchDiagnostic(encoded)?.failureClass, "unknown_provider_error");
    assert.equal(decodeOutboundDispatchDiagnostic("legacy error"), null);
  });
});
