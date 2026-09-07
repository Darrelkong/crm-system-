import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateLargeAttachmentGatewayAuthorization,
  type LargeAttachmentGatewayAuthorizationIdentity,
} from "./large-attachment-download-authorization-service";

const TOKEN_HASH = "a".repeat(64);
const CONTENT_HASH = "b".repeat(64);
const NOW = "2026-09-06T08:00:00.000Z";
const EXPIRY = "2026-09-13T08:00:00.000Z";

function identity(): LargeAttachmentGatewayAuthorizationIdentity {
  return {
    deliveryToken: {
      id: "delivery-token-1",
      lifecycleId: "lifecycle-1",
      revisionId: "revision-1",
      sendOperationId: "send-operation-1",
      transportAttemptId: "transport-attempt-1",
      tokenHash: TOKEN_HASH,
      state: "confirmed",
      expiresAt: EXPIRY,
      providerMessageId: "provider-message-1",
    },
    lifecycle: {
      id: "lifecycle-1",
      storedFileId: "stored-file-1",
      status: "sent",
      recipientExpiresAt: EXPIRY,
      downloadTokenHash: TOKEN_HASH,
      declaredContentHash: CONTENT_HASH,
      storageVersion: "version-1",
      storageEtag: "etag-1",
      downloadCount: 0,
    },
    storedFile: {
      id: "stored-file-1",
      contentHash: CONTENT_HASH,
      originalFilename: "quarterly-report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
      storageProvider: "r2",
      storageBucket: "crm-mail-large-attachments",
      storageKey:
        "mail/large-attachments/2026/09/00000000-0000-4000-8000-000000000001",
      securityScanStatus: "unscanned",
    },
    usage: {
      storedFileId: "stored-file-1",
      contentHash: CONTENT_HASH,
      displayFilename: "客户报告.pdf",
      originalFilename: "quarterly-report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
      deliveryMode: "large_attachment",
    },
  };
}

describe("large attachment CRM gateway authorization", () => {
  it("returns only minimal validated storage metadata", () => {
    const result = evaluateLargeAttachmentGatewayAuthorization({
      identity: identity(),
      tokenHash: TOKEN_HASH,
      trustNowIso: NOW,
    });

    assert.equal(result.authorized, true);
    if (result.authorized) {
      assert.deepEqual(result, {
        authorized: true,
        lifecycleId: "lifecycle-1",
        storageKey:
          "mail/large-attachments/2026/09/00000000-0000-4000-8000-000000000001",
        filename: "客户报告.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageVersion: "version-1",
        storageEtag: "etag-1",
        recipientExpiresAt: EXPIRY,
      });
      assert.equal("mailboxId" in result, false);
      assert.equal("messageId" in result, false);
      assert.equal("userId" in result, false);
    }
  });

  it("allows armed capabilities before lifecycle sent and denies inactive states", () => {
    const armed = {
      ...identity(),
      deliveryToken: {
        ...identity().deliveryToken,
        state: "armed" as const,
      },
      lifecycle: {
        ...identity().lifecycle,
        status: "approval_hold" as const,
        recipientExpiresAt: null,
        downloadTokenHash: null,
      },
    };
    assert.equal(
      evaluateLargeAttachmentGatewayAuthorization({
        identity: armed,
        tokenHash: TOKEN_HASH,
        trustNowIso: NOW,
      }).authorized,
      true,
    );

    for (const state of ["prepared", "revoked", "expired"] as const) {
      assert.deepEqual(
        evaluateLargeAttachmentGatewayAuthorization({
          identity: {
            ...armed,
            deliveryToken: { ...armed.deliveryToken, state },
          },
          tokenHash: TOKEN_HASH,
          trustNowIso: NOW,
        }),
        { authorized: false },
        state,
      );
    }
  });

  it("fails closed for token, lifecycle, expiry, and deleted-file mismatches", () => {
    const cases = [
      {
        name: "unknown token hash",
        input: { tokenHash: "c".repeat(64) },
      },
      {
        name: "expired lifecycle",
        input: { identity: { ...identity(), lifecycle: { ...identity().lifecycle, recipientExpiresAt: NOW } } },
      },
      {
        name: "revoked lifecycle",
        input: { identity: { ...identity(), lifecycle: { ...identity().lifecycle, status: "revoked" as const } } },
      },
      {
        name: "deleted lifecycle",
        input: { identity: { ...identity(), lifecycle: { ...identity().lifecycle, status: "deleted" as const } } },
      },
      {
        name: "forged file relation",
        input: { identity: { ...identity(), lifecycle: { ...identity().lifecycle, storedFileId: "other-file" } } },
      },
      {
        name: "forged storage key",
        input: { identity: { ...identity(), storedFile: { ...identity().storedFile, storageKey: "mail/large-attachments/2026/09/other" } } },
      },
      {
        name: "cross-file usage",
        input: { identity: { ...identity(), usage: { ...identity().usage, storedFileId: "other-file" } } },
      },
    ] as const;

    for (const testCase of cases) {
      const testIdentity =
        "identity" in testCase.input ? testCase.input.identity : identity();
      const testTokenHash =
        "tokenHash" in testCase.input ? testCase.input.tokenHash : TOKEN_HASH;
      const result = evaluateLargeAttachmentGatewayAuthorization({
        identity: testIdentity,
        tokenHash: testTokenHash,
        trustNowIso: NOW,
      });
      assert.deepEqual(result, { authorized: false }, testCase.name);
    }
  });

  it("rejects malformed token hashes and unsafe storage identity", () => {
    assert.deepEqual(
      evaluateLargeAttachmentGatewayAuthorization({
        identity: identity(),
        tokenHash: "not-a-sha256",
        trustNowIso: NOW,
      }),
      { authorized: false },
    );
    assert.deepEqual(
      evaluateLargeAttachmentGatewayAuthorization({
        identity: {
          ...identity(),
          storedFile: {
            ...identity().storedFile,
            storageBucket: "another-bucket",
          },
        },
        tokenHash: TOKEN_HASH,
        trustNowIso: NOW,
      }),
      { authorized: false },
    );
  });
});
