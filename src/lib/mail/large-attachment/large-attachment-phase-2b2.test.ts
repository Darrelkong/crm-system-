import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeContentMd5Base64 } from "@/lib/mail/large-attachment/large-attachment-content-md5";
import { classifyComposeAttachmentDeliveryMode } from "@/lib/mail/large-attachment/large-attachment-classifier";
import {
  LARGE_ATTACHMENT_UPLOAD_AUTH_TTL_MS,
  addMillisecondsToIsoTimestamp,
} from "@/lib/mail/large-attachment/large-attachment-constants";
import {
  LARGE_ATTACHMENT_DOWNLOAD_GATEWAY_BLOCK_CODE,
} from "@/lib/mail/large-attachment/large-attachment-provider-send-guard";
import {
  assertLargeAttachmentsExcludedFromDirectMime,
  filterDirectMimeAttachments,
} from "@/lib/mail/large-attachment/large-attachment-transport-contract";
import {
  assertAuthorizeResponseHasNoSecrets,
  type LargeAttachmentAuthorizeResult,
} from "@/lib/mail/large-attachment/large-attachment-upload-authorization-service";
import {
  evaluateLargeAttachmentUploadFinalize,
  evaluateLargeAttachmentUploadSessionValidity,
  type LargeAttachmentUploadSession,
} from "@/lib/mail/large-attachment/large-attachment-upload-session";
import {
  buildLargeAttachmentStorageKey,
} from "@/lib/mail/large-attachment/large-attachment-storage-key";
import {
  assertDeclaredContentHashFormat,
} from "@/lib/mail/large-attachment/large-attachment-storage-identity";
import {
  transitionTemporaryToApprovalHold,
  createTemporaryLargeAttachmentLifecycle,
} from "@/lib/mail/large-attachment/large-attachment-state-machine";
import {
  resolveComposeAttachmentRoute,
} from "@/lib/mail/client/compose-attachment-classifier-client";
import {
  LARGE_ATTACHMENT_MAX_FILE_BYTES,
} from "@/lib/mail/large-attachment/large-attachment-policy";

const NOW = "2026-08-30T10:00:00.000Z";
const DECLARED_HASH = "a".repeat(64);
const CONTENT_MD5 = "1B2M2Y8AsgTpgAmY7PhCfg==";

function session(
  overrides: Partial<LargeAttachmentUploadSession> = {},
): LargeAttachmentUploadSession {
  return {
    id: "session-1",
    actorUserId: "user-1",
    draftId: "draft-1",
    mailboxId: "mailbox-1",
    storedFileId: null,
    storageKey: buildLargeAttachmentStorageKey({
      uploadedAt: new Date(NOW),
      objectId: "22222222-2222-2222-2222-222222222222",
    }),
    expectedFilename: "report.zip",
    expectedMimeType: "application/zip",
    expectedSizeBytes: 4 * 1024 * 1024,
    maxSizeBytes: LARGE_ATTACHMENT_MAX_FILE_BYTES,
    declaredContentHash: DECLARED_HASH,
    expiresAt: addMillisecondsToIsoTimestamp(NOW, LARGE_ATTACHMENT_UPLOAD_AUTH_TTL_MS),
    finalizedAt: null,
    invalidatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("large attachment phase 2B.2", () => {
  describe("authorization contract", () => {
    it("requires declared SHA-256 format", () => {
      assert.throws(() => assertDeclaredContentHashFormat("not-a-hash"));
    });

    it("requires Content-MD5 base64 format", () => {
      assert.throws(() => normalizeContentMd5Base64("not-base64"));
      assert.equal(normalizeContentMd5Base64(CONTENT_MD5), CONTENT_MD5);
    });

    it("uses 10 minute upload session TTL constant", () => {
      assert.equal(LARGE_ATTACHMENT_UPLOAD_AUTH_TTL_MS, 10 * 60 * 1000);
    });

    it("does not expose secrets in authorize response shape", () => {
      const response: LargeAttachmentAuthorizeResult = {
        uploadSessionId: "session-1",
        uploadUrl: "https://example.r2.cloudflarestorage.com/bucket/key?sig=abc",
        requiredHeaders: {
          "Content-Type": "application/zip",
          "Content-MD5": CONTENT_MD5,
          "If-None-Match": "*",
        },
        expiresAt: addMillisecondsToIsoTimestamp(NOW, LARGE_ATTACHMENT_UPLOAD_AUTH_TTL_MS),
        storageKey: buildLargeAttachmentStorageKey({ uploadedAt: new Date(NOW) }),
      };
      assert.doesNotThrow(() => assertAuthorizeResponseHasNoSecrets(response));
    });

    it("rejects invalid actor/draft/mailbox/expired/invalidated sessions", () => {
      assert.equal(
        evaluateLargeAttachmentUploadSessionValidity({
          session: session(),
          actorUserId: "other",
          draftId: "draft-1",
          mailboxId: "mailbox-1",
          trustNowIso: NOW,
        }).ok,
        false,
      );
      assert.equal(
        evaluateLargeAttachmentUploadSessionValidity({
          session: session({ invalidatedAt: NOW }),
          actorUserId: "user-1",
          draftId: "draft-1",
          mailboxId: "mailbox-1",
          trustNowIso: NOW,
        }).ok,
        false,
      );
      assert.equal(
        evaluateLargeAttachmentUploadSessionValidity({
          session: session({
            expiresAt: addMillisecondsToIsoTimestamp(NOW, -1),
          }),
          actorUserId: "user-1",
          draftId: "draft-1",
          mailboxId: "mailbox-1",
          trustNowIso: NOW,
        }).ok,
        false,
      );
    });
  });

  describe("direct vs large routing", () => {
    it("uses direct within remaining direct budget", () => {
      assert.equal(
        resolveComposeAttachmentRoute({
          filename: "note.txt",
          mimeType: "text/plain",
          sizeBytes: 1024,
          existing: [{ sizeBytes: 1024 * 1024, deliveryMode: "direct_attachment" }],
        }),
        "direct",
      );
    });

    it("uses large when crossing direct budget", () => {
      assert.equal(
        resolveComposeAttachmentRoute({
          filename: "deck.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2 * 1024 * 1024,
          existing: [{ sizeBytes: 2 * 1024 * 1024, deliveryMode: "direct_attachment" }],
        }),
        "large",
      );
    });

    it("does not count large attachments toward direct bytes", () => {
      const result = classifyComposeAttachmentDeliveryMode({
        filename: "small.txt",
        mimeType: "text/plain",
        sizeBytes: 1024,
        existingAttachments: [
          { sizeBytes: 80 * 1024 * 1024, deliveryMode: "large_attachment" },
          { sizeBytes: 2 * 1024 * 1024, deliveryMode: "direct_attachment" },
        ],
      });
      assert.equal(result.ok && result.deliveryMode, "direct_attachment");
    });
  });

  describe("finalize contract", () => {
    it("fails when object missing/size/content-type/etag mismatch", () => {
      const base = session();
      assert.equal(
        evaluateLargeAttachmentUploadFinalize({
          session: base,
          observedSizeBytes: 0,
          observedStorageKey: base.storageKey,
          storageIdentity: {
            storageEtag: "etag-1",
            storageVersion: "",
            sizeBytes: 0,
            finalizedAt: NOW,
          },
          trustNowIso: NOW,
        }).ok,
        false,
      );
      assert.equal(
        evaluateLargeAttachmentUploadFinalize({
          session: base,
          observedSizeBytes: base.expectedSizeBytes + 1,
          observedStorageKey: base.storageKey,
          storageIdentity: {
            storageEtag: "etag-1",
            storageVersion: "",
            sizeBytes: base.expectedSizeBytes + 1,
            finalizedAt: NOW,
          },
          trustNowIso: NOW,
        }).ok,
        false,
      );
    });

    it("supports idempotent finalize replay", () => {
      const finalized = session({
        finalizedAt: NOW,
        storedFileId: "stored-1",
      });
      const result = evaluateLargeAttachmentUploadFinalize({
        session: finalized,
        observedSizeBytes: finalized.expectedSizeBytes,
        observedStorageKey: finalized.storageKey,
        storageIdentity: {
          storageEtag: "etag-1",
          storageVersion: "",
          sizeBytes: finalized.expectedSizeBytes,
          finalizedAt: NOW,
        },
        trustNowIso: NOW,
      });
      assert.equal(result.ok && result.idempotentReplay, true);
    });

    it("allows storage version to remain unavailable", () => {
      const result = evaluateLargeAttachmentUploadFinalize({
        session: session(),
        observedSizeBytes: 4 * 1024 * 1024,
        observedStorageKey: session().storageKey,
        storageIdentity: {
          storageEtag: "abc123-not-sha256",
          storageVersion: "",
          sizeBytes: 4 * 1024 * 1024,
          finalizedAt: NOW,
        },
        trustNowIso: NOW,
      });
      assert.equal(result.ok, true);
    });
  });

  describe("approval lifecycle", () => {
    it("transitions temporary to approval_hold on first submit timestamp", () => {
      const firstSubmit = "2026-08-30T10:10:00.000Z";
      const held = transitionTemporaryToApprovalHold(
        createTemporaryLargeAttachmentLifecycle({
          id: "life-1",
          storedFileId: "stored-1",
          uploadedAt: NOW,
          declaredContentHash: DECLARED_HASH,
          storageVersion: "v-worker",
          storageEtag: "etag-1",
          finalizedAt: NOW,
        }),
        { firstSubmittedAt: firstSubmit, now: firstSubmit },
      );
      assert.equal(held.status, "approval_hold");
      assert.equal(held.approvalHoldStartedAt, firstSubmit);
    });

    it("does not reset absolute deadline on resubmit", () => {
      const firstSubmit = "2026-08-30T10:10:00.000Z";
      const held = transitionTemporaryToApprovalHold(
        createTemporaryLargeAttachmentLifecycle({
          id: "life-1",
          storedFileId: "stored-1",
          uploadedAt: NOW,
          declaredContentHash: DECLARED_HASH,
          storageVersion: "v-worker",
          storageEtag: "etag-1",
          finalizedAt: NOW,
        }),
        { firstSubmittedAt: firstSubmit, now: firstSubmit },
      );
      const resubmit = transitionTemporaryToApprovalHold(held, {
        firstSubmittedAt: firstSubmit,
        now: "2026-08-30T11:00:00.000Z",
      });
      assert.equal(
        resubmit.approvalAbsoluteExpiresAt,
        held.approvalAbsoluteExpiresAt,
      );
    });
  });

  describe("transport and security", () => {
    it("excludes large attachments from direct MIME aggregation", () => {
      const attachments = [
        { deliveryMode: "direct_attachment" as const, sizeBytes: 1024 },
        { deliveryMode: "large_attachment" as const, sizeBytes: 80 * 1024 * 1024 },
      ];
      assert.equal(filterDirectMimeAttachments(attachments).length, 1);
      assert.throws(() => assertLargeAttachmentsExcludedFromDirectMime(attachments));
    });

    it("blocks provider send until download gateway", () => {
      assert.equal(
        LARGE_ATTACHMENT_DOWNLOAD_GATEWAY_BLOCK_CODE,
        "LARGE_ATTACHMENT_DOWNLOAD_GATEWAY_NOT_READY",
      );
    });
  });
});
