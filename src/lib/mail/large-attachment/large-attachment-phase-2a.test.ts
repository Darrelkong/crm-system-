import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyComposeAttachmentDeliveryMode } from "@/lib/mail/large-attachment/large-attachment-classifier";
import {
  LARGE_ATTACHMENT_APPROVAL_MAX_RETENTION_MS,
  LARGE_ATTACHMENT_RECIPIENT_RETENTION_MS,
  LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS,
  addMillisecondsToIsoTimestamp,
} from "@/lib/mail/large-attachment/large-attachment-constants";
import {
  encodeLargeAttachmentPublicToken,
  generateLargeAttachmentDownloadTokenPair,
  hashLargeAttachmentDownloadToken,
  toLargeAttachmentLifecyclePersistedDownloadFields,
} from "@/lib/mail/large-attachment/large-attachment-download-token";
import {
  evaluateLargeAttachmentApprovalSubmitEligibility,
  evaluateLargeAttachmentSendEligibility,
} from "@/lib/mail/large-attachment/large-attachment-eligibility";
import {
  DIRECT_COMPOSE_ATTACHMENT_AGGREGATE_BYTES,
  LARGE_ATTACHMENT_MAX_AGGREGATE_BYTES,
  LARGE_ATTACHMENT_MAX_FILE_BYTES,
  TOTAL_COMPOSE_ATTACHMENT_MAX_COUNT,
} from "@/lib/mail/large-attachment/large-attachment-policy";
import {
  assertRevisionSnapshotHasNoMutableDownloadUrl,
  buildLargeAttachmentRevisionSnapshotFields,
} from "@/lib/mail/large-attachment/large-attachment-revision-snapshot";
import {
  LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS,
  isLargeAttachmentSecurityScanEligible,
  largeAttachmentStoredFileScanStatusOnFinalize,
} from "@/lib/mail/large-attachment/large-attachment-security";
import {
  assertLargeAttachmentStorageKey,
  buildLargeAttachmentStorageKey,
  largeAttachmentStorageKeyContainsFilename,
} from "@/lib/mail/large-attachment/large-attachment-storage-key";
import {
  assertLargeAttachmentsExcludedFromDirectMime,
  filterDirectMimeAttachments,
  sumDirectMimeAttachmentBytes,
} from "@/lib/mail/large-attachment/large-attachment-transport-contract";
import {
  assertNoBackwardTransitionToSent,
  createTemporaryLargeAttachmentLifecycle,
  evaluateApprovalAbsoluteExpiry,
  evaluateTemporaryExpiry,
  transitionAcceptedSendToSent,
  transitionTemporaryToApprovalHold,
  transitionToDeleted,
  transitionToExpired,
  transitionToRevoked,
  type LargeAttachmentLifecycleRecord,
} from "@/lib/mail/large-attachment/large-attachment-state-machine";
import {
  evaluateLargeAttachmentUploadFinalize,
  evaluateLargeAttachmentUploadSessionValidity,
  type LargeAttachmentUploadSession,
} from "@/lib/mail/large-attachment/large-attachment-upload-session";

const UPLOADED_AT = "2026-08-30T10:00:00.000Z";
const STORED_FILE_ID = "11111111-1111-1111-1111-111111111111";

const DECLARED_HASH = "a".repeat(64);
const STORAGE_VERSION = "v1";
const STORAGE_ETAG = "abc123-not-sha256";

function temporaryLifecycle(
  overrides: Partial<LargeAttachmentLifecycleRecord> = {},
): LargeAttachmentLifecycleRecord {
  return {
    ...createTemporaryLargeAttachmentLifecycle({
      id: "lifecycle-1",
      storedFileId: STORED_FILE_ID,
      uploadedAt: UPLOADED_AT,
      declaredContentHash: DECLARED_HASH,
      storageVersion: STORAGE_VERSION,
      storageEtag: STORAGE_ETAG,
      finalizedAt: UPLOADED_AT,
    }),
    ...overrides,
  };
}

function uploadSession(
  overrides: Partial<LargeAttachmentUploadSession> = {},
): LargeAttachmentUploadSession {
  return {
    id: "session-1",
    actorUserId: "user-1",
    draftId: "draft-1",
    mailboxId: "mailbox-1",
    storedFileId: STORED_FILE_ID,
    storageKey: buildLargeAttachmentStorageKey({
      uploadedAt: new Date(UPLOADED_AT),
      objectId: "22222222-2222-2222-2222-222222222222",
    }),
    expectedFilename: "report.zip",
    expectedMimeType: "application/zip",
    expectedSizeBytes: 4 * 1024 * 1024,
    maxSizeBytes: LARGE_ATTACHMENT_MAX_FILE_BYTES,
    declaredContentHash: DECLARED_HASH,
    expiresAt: addMillisecondsToIsoTimestamp(UPLOADED_AT, 10 * 60 * 1000),
    finalizedAt: null,
    invalidatedAt: null,
    createdAt: UPLOADED_AT,
    updatedAt: UPLOADED_AT,
    ...overrides,
  };
}

describe("large attachment phase 2A domain", () => {
  describe("policy constants", () => {
    it("preserves direct 3 MiB budget", () => {
      assert.equal(DIRECT_COMPOSE_ATTACHMENT_AGGREGATE_BYTES, 3 * 1024 * 1024);
    });

    it("defines large limits and total count", () => {
      assert.equal(LARGE_ATTACHMENT_MAX_FILE_BYTES, 100 * 1024 * 1024);
      assert.equal(LARGE_ATTACHMENT_MAX_AGGREGATE_BYTES, 300 * 1024 * 1024);
      assert.equal(TOTAL_COMPOSE_ATTACHMENT_MAX_COUNT, 10);
    });
  });

  describe("classifier", () => {
    it("classifies within direct aggregate as direct", () => {
      const result = classifyComposeAttachmentDeliveryMode({
        filename: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 1024,
        existingAttachments: [
          { sizeBytes: 1024 * 1024, deliveryMode: "direct_attachment" },
        ],
      });
      assert.equal(result.ok && result.deliveryMode, "direct_attachment");
    });

    it("classifies crossing direct aggregate as large", () => {
      const result = classifyComposeAttachmentDeliveryMode({
        filename: "deck.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2 * 1024 * 1024,
        existingAttachments: [
          { sizeBytes: 2 * 1024 * 1024, deliveryMode: "direct_attachment" },
        ],
      });
      assert.equal(result.ok && result.deliveryMode, "large_attachment");
    });

    it("rejects files above 100 MiB", () => {
      const result = classifyComposeAttachmentDeliveryMode({
        filename: "huge.bin",
        mimeType: "application/octet-stream",
        sizeBytes: LARGE_ATTACHMENT_MAX_FILE_BYTES + 1,
        existingAttachments: [],
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FILE_TOO_LARGE");
    });

    it("rejects large aggregate above 300 MiB", () => {
      const result = classifyComposeAttachmentDeliveryMode({
        filename: "part.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 50 * 1024 * 1024,
        existingAttachments: [
          {
            sizeBytes: 260 * 1024 * 1024,
            deliveryMode: "large_attachment",
          },
        ],
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "LARGE_AGGREGATE_EXCEEDED");
    });

    it("rejects 11th attachment", () => {
      const existing = Array.from({ length: 10 }, (_, index) => ({
        sizeBytes: 1024,
        deliveryMode: "direct_attachment" as const,
      }));
      const result = classifyComposeAttachmentDeliveryMode({
        filename: "extra.txt",
        mimeType: "text/plain",
        sizeBytes: 512,
        existingAttachments: existing,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "TOO_MANY_ATTACHMENTS");
    });

    it("rejects blocked extension instead of converting to large", () => {
      const result = classifyComposeAttachmentDeliveryMode({
        filename: "setup.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 10 * 1024 * 1024,
        existingAttachments: [],
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "UNSUPPORTED_FILE_TYPE");
    });

    it("rejects blocked MIME instead of converting to large", () => {
      const result = classifyComposeAttachmentDeliveryMode({
        filename: "script.js",
        mimeType: "application/javascript",
        sizeBytes: 10 * 1024 * 1024,
        existingAttachments: [],
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "UNSUPPORTED_FILE_TYPE");
    });
  });

  describe("state machine", () => {
    it("temporary starts with 24h expiry", () => {
      const record = temporaryLifecycle();
      assert.equal(record.status, "temporary");
      assert.equal(
        record.temporaryExpiresAt,
        addMillisecondsToIsoTimestamp(
          UPLOADED_AT,
          LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS,
        ),
      );
    });

    it("transitions temporary to approval_hold", () => {
      const submittedAt = "2026-08-30T10:10:00.000Z";
      const record = transitionTemporaryToApprovalHold(temporaryLifecycle(), {
        firstSubmittedAt: submittedAt,
        now: submittedAt,
      });
      assert.equal(record.status, "approval_hold");
      assert.equal(record.approvalHoldStartedAt, submittedAt);
      assert.equal(
        record.approvalAbsoluteExpiresAt,
        addMillisecondsToIsoTimestamp(
          submittedAt,
          LARGE_ATTACHMENT_APPROVAL_MAX_RETENTION_MS,
        ),
      );
    });

    it("preserves absolute cap on resubmit", () => {
      const firstSubmit = "2026-08-30T10:10:00.000Z";
      const first = transitionTemporaryToApprovalHold(temporaryLifecycle(), {
        firstSubmittedAt: firstSubmit,
        now: firstSubmit,
      });
      const resubmit = transitionTemporaryToApprovalHold(first, {
        firstSubmittedAt: firstSubmit,
        now: "2026-08-31T09:00:00.000Z",
      });
      assert.equal(resubmit.approvalAbsoluteExpiresAt, first.approvalAbsoluteExpiresAt);
    });

    it("returned workflow does not reset absolute cap when firstSubmittedAt preserved", () => {
      const firstSubmit = "2026-08-30T10:10:00.000Z";
      const held = transitionTemporaryToApprovalHold(temporaryLifecycle(), {
        firstSubmittedAt: firstSubmit,
        now: firstSubmit,
      });
      const afterReturn = transitionTemporaryToApprovalHold(held, {
        firstSubmittedAt: firstSubmit,
        now: "2026-09-01T12:00:00.000Z",
      });
      assert.equal(
        afterReturn.approvalAbsoluteExpiresAt,
        held.approvalAbsoluteExpiresAt,
      );
    });

    it("detects temporary expiry", () => {
      const record = temporaryLifecycle();
      const expiredAt = addMillisecondsToIsoTimestamp(
        UPLOADED_AT,
        LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS + 1,
      );
      assert.equal(evaluateTemporaryExpiry(record, expiredAt), true);
    });

    it("detects approval absolute expiry", () => {
      const firstSubmit = "2026-08-30T10:10:00.000Z";
      const held = transitionTemporaryToApprovalHold(temporaryLifecycle(), {
        firstSubmittedAt: firstSubmit,
        now: firstSubmit,
      });
      const expiredAt = addMillisecondsToIsoTimestamp(
        firstSubmit,
        LARGE_ATTACHMENT_APPROVAL_MAX_RETENTION_MS + 1,
      );
      assert.equal(evaluateApprovalAbsoluteExpiry(held, expiredAt), true);
    });

    it("admin_direct sends from temporary without approval_hold", () => {
      const sentAt = "2026-08-30T11:00:00.000Z";
      const sent = transitionAcceptedSendToSent(temporaryLifecycle(), {
        sentAt,
        downloadTokenHash: "a".repeat(64),
        authorizationPath: "admin_direct",
      });
      assert.equal(sent.status, "sent");
      assert.equal(sent.sentAt, sentAt);
      assert.equal(
        sent.recipientExpiresAt,
        addMillisecondsToIsoTimestamp(sentAt, LARGE_ATTACHMENT_RECIPIENT_RETENTION_MS),
      );
    });

    it("staff approved sends from approval_hold", () => {
      const firstSubmit = "2026-08-30T10:10:00.000Z";
      const held = transitionTemporaryToApprovalHold(temporaryLifecycle(), {
        firstSubmittedAt: firstSubmit,
        now: firstSubmit,
      });
      const sentAt = "2026-08-30T12:00:00.000Z";
      const sent = transitionAcceptedSendToSent(held, {
        sentAt,
        downloadTokenHash: "b".repeat(64),
        authorizationPath: "staff_approved",
      });
      assert.equal(sent.status, "sent");
    });

    it("blocks expired to sent transitions", () => {
      const expired = transitionToExpired(temporaryLifecycle(), {
        now: "2026-08-31T11:00:00.000Z",
        reason: "temporary_expired",
      });
      assert.throws(() =>
        assertNoBackwardTransitionToSent(expired.status),
      );
      assert.throws(() =>
        transitionAcceptedSendToSent(expired, {
          sentAt: "2026-08-31T12:00:00.000Z",
          downloadTokenHash: "c".repeat(64),
          authorizationPath: "admin_direct",
        }),
      );
    });

    it("blocks deleted and revoked to sent", () => {
      const deleted = transitionToDeleted(temporaryLifecycle(), {
        now: "2026-08-30T12:00:00.000Z",
        reason: "manual_remove",
      });
      assert.throws(() => assertNoBackwardTransitionToSent(deleted.status));

      const firstSubmit = "2026-08-30T10:10:00.000Z";
      const sent = transitionAcceptedSendToSent(
        transitionTemporaryToApprovalHold(temporaryLifecycle(), {
          firstSubmittedAt: firstSubmit,
          now: firstSubmit,
        }),
        {
          sentAt: "2026-08-30T12:00:00.000Z",
          downloadTokenHash: "d".repeat(64),
          authorizationPath: "staff_approved",
        },
      );
      const revoked = transitionToRevoked(sent, {
        now: "2026-08-30T13:00:00.000Z",
        reason: "operator_revoked",
      });
      assert.throws(() => assertNoBackwardTransitionToSent(revoked.status));
    });
  });

  describe("eligibility", () => {
    it("blocks approval submit when temporary expired", () => {
      const lifecycle = temporaryLifecycle();
      const trustNow = addMillisecondsToIsoTimestamp(
        UPLOADED_AT,
        LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS + 1,
      );
      const result = evaluateLargeAttachmentApprovalSubmitEligibility({
        deliveryMode: "large_attachment",
        lifecycle,
        sizeBytes: 1024,
        securityScanStatus: LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS,
        trustNowIso: trustNow,
        uploadFinalized: true,
      });
      assert.equal(result.ok, false);
    });

    it("blocks send for expired approval attachment", () => {
      const firstSubmit = "2026-08-30T10:10:00.000Z";
      const held = transitionTemporaryToApprovalHold(temporaryLifecycle(), {
        firstSubmittedAt: firstSubmit,
        now: firstSubmit,
      });
      const trustNow = addMillisecondsToIsoTimestamp(
        firstSubmit,
        LARGE_ATTACHMENT_APPROVAL_MAX_RETENTION_MS + 1,
      );
      const result = evaluateLargeAttachmentSendEligibility({
        deliveryMode: "large_attachment",
        lifecycle: held,
        sizeBytes: 1024,
        securityScanStatus: LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS,
        trustNowIso: trustNow,
        uploadFinalized: true,
        allowApprovalHold: true,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "APPROVAL_HOLD_EXPIRED");
    });
  });

  describe("transport contract", () => {
    it("excludes large attachments from direct MIME aggregation", () => {
      const attachments = [
        { deliveryMode: "direct_attachment" as const, sizeBytes: 1024 },
        { deliveryMode: "large_attachment" as const, sizeBytes: 80 * 1024 * 1024 },
      ];
      assert.equal(sumDirectMimeAttachmentBytes(attachments), 1024);
      assert.equal(filterDirectMimeAttachments(attachments).length, 1);
      assert.throws(() => assertLargeAttachmentsExcludedFromDirectMime(attachments));
    });
  });

  describe("revision snapshot", () => {
    it("supports large_attachment revision snapshot without mutable URL", () => {
      const snapshot = buildLargeAttachmentRevisionSnapshotFields({
        storedFileId: STORED_FILE_ID,
        contentHash: "e".repeat(64),
        displayFilename: "report.zip",
        mimeType: "application/zip",
        sizeBytes: 1024,
        sortOrder: 0,
        storageVersion: STORAGE_VERSION,
        storageEtag: STORAGE_ETAG,
      });
      assert.equal(snapshot.deliveryMode, "large_attachment");
      assert.equal(snapshot.secureExpiryDays, null);
      assert.doesNotThrow(() => assertRevisionSnapshotHasNoMutableDownloadUrl(snapshot));
    });
  });

  describe("download token", () => {
    it("uses >=128-bit base64url token and stores hash only in persisted fields", () => {
      const bytes = new Uint8Array(16).map((_, index) => index);
      const token = encodeLargeAttachmentPublicToken(bytes);
      assert.equal(token.length, 22);
      assert.doesNotMatch(token, /[+/=]/);
      const hash = hashLargeAttachmentDownloadToken(token);
      assert.equal(hash.length, 64);
      const persisted = toLargeAttachmentLifecyclePersistedDownloadFields({
        downloadTokenHash: hash,
      });
      assert.equal(persisted.downloadTokenHash, hash);
      assert.ok(!("token" in persisted));
    });

    it("generates token/hash pair without persisting raw token in lifecycle DTO", () => {
      const pair = generateLargeAttachmentDownloadTokenPair(() =>
        new Uint8Array(16).fill(7),
      );
      assert.ok(pair.token.length >= 20);
      assert.equal(pair.tokenHash, hashLargeAttachmentDownloadToken(pair.token));
    });
  });

  describe("storage key", () => {
    it("uses opaque server-generated key without filename or email", () => {
      const key = buildLargeAttachmentStorageKey({
        uploadedAt: new Date("2026-08-30T10:00:00.000Z"),
        objectId: "33333333-3333-3333-3333-333333333333",
      });
      assert.doesNotThrow(() => assertLargeAttachmentStorageKey(key));
      assert.equal(
        largeAttachmentStorageKeyContainsFilename(key, "secret-report.zip"),
        false,
      );
      assert.doesNotMatch(key, /@/);
    });
  });

  describe("upload session security", () => {
    it("binds session to actor, draft, and mailbox", () => {
      const session = uploadSession();
      assert.equal(
        evaluateLargeAttachmentUploadSessionValidity({
          session,
          actorUserId: "user-1",
          draftId: "draft-1",
          mailboxId: "mailbox-1",
          trustNowIso: UPLOADED_AT,
        }).ok,
        true,
      );
      assert.equal(
        evaluateLargeAttachmentUploadSessionValidity({
          session,
          actorUserId: "other-user",
          draftId: "draft-1",
          mailboxId: "mailbox-1",
          trustNowIso: UPLOADED_AT,
        }).ok,
        false,
      );
    });

    it("finalize verifies object key and size", () => {
      const session = uploadSession();
      const result = evaluateLargeAttachmentUploadFinalize({
        session,
        observedSizeBytes: session.expectedSizeBytes,
        observedStorageKey: session.storageKey,
        storageIdentity: {
          storageVersion: STORAGE_VERSION,
          storageEtag: STORAGE_ETAG,
          sizeBytes: session.expectedSizeBytes,
          finalizedAt: UPLOADED_AT,
        },
        trustNowIso: UPLOADED_AT,
      });
      assert.equal(result.ok, true);
    });
  });

  describe("security semantics", () => {
    it("does not mark large attachments as falsely clean", () => {
      assert.equal(largeAttachmentStoredFileScanStatusOnFinalize(), "unscanned");
      assert.equal(isLargeAttachmentSecurityScanEligible("clean"), false);
      assert.equal(
        isLargeAttachmentSecurityScanEligible(LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS),
        true,
      );
    });
  });
});
