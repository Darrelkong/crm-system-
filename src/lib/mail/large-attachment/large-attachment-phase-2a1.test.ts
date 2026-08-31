import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPublicDownloadWorkerHasNoBusinessEmail,
  assertPublicDownloadWorkerHasNoDirectD1Binding,
  sanitizeInternalDownloadAuthorizationResult,
  toInternalDownloadLookupPersistedFields,
} from "@/lib/mail/large-attachment/large-attachment-download-authorization";
import {
  etagEqualsContentHash,
  LARGE_ATTACHMENT_CHECKSUM_ENFORCEMENT_STATUS,
  LARGE_ATTACHMENT_REQUIRES_FULL_CRM_REREAD_FOR_HASH,
} from "@/lib/mail/large-attachment/large-attachment-storage-identity";
import {
  assertRevisionSnapshotHasNoMutableDownloadUrl,
  buildLargeAttachmentRevisionSnapshotFields,
} from "@/lib/mail/large-attachment/large-attachment-revision-snapshot";
import {
  evaluateLargeAttachmentSendEligibility,
} from "@/lib/mail/large-attachment/large-attachment-eligibility";
import {
  createTemporaryLargeAttachmentLifecycle,
  type LargeAttachmentLifecycleRecord,
} from "@/lib/mail/large-attachment/large-attachment-state-machine";
import {
  assertUploadSessionHasNoPresignedUrlPersisted,
  evaluateLargeAttachmentUploadFinalize,
  evaluateLargeAttachmentUploadSessionValidity,
  invalidateLargeAttachmentUploadSession,
  type LargeAttachmentUploadSession,
} from "@/lib/mail/large-attachment/large-attachment-upload-session";
import { buildLargeAttachmentStorageKey } from "@/lib/mail/large-attachment/large-attachment-storage-key";
import { addMillisecondsToIsoTimestamp } from "@/lib/mail/large-attachment/large-attachment-constants";
import { LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS } from "@/lib/mail/large-attachment/large-attachment-security";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "drizzle/migrations/0070_mail_large_attachment_lifecycle.sql"),
  "utf8",
);
const UPLOADED_AT = "2026-08-30T10:00:00.000Z";
const DECLARED_HASH = "b".repeat(64);

function session(overrides: Partial<LargeAttachmentUploadSession> = {}): LargeAttachmentUploadSession {
  return {
    id: "sess-1",
    actorUserId: "user-1",
    draftId: "draft-1",
    mailboxId: "mailbox-1",
    storedFileId: null,
    storageKey: buildLargeAttachmentStorageKey({
      uploadedAt: new Date(UPLOADED_AT),
      objectId: "44444444-4444-4444-4444-444444444444",
    }),
    expectedFilename: "pack.zip",
    expectedMimeType: "application/zip",
    expectedSizeBytes: 1024,
    maxSizeBytes: 100 * 1024 * 1024,
    declaredContentHash: DECLARED_HASH,
    expiresAt: addMillisecondsToIsoTimestamp(UPLOADED_AT, 10 * 60 * 1000),
    finalizedAt: null,
    invalidatedAt: null,
    createdAt: UPLOADED_AT,
    updatedAt: UPLOADED_AT,
    ...overrides,
  };
}

function lifecycle(overrides: Partial<LargeAttachmentLifecycleRecord> = {}): LargeAttachmentLifecycleRecord {
  return {
    ...createTemporaryLargeAttachmentLifecycle({
      id: "life-1",
      storedFileId: "11111111-1111-1111-1111-111111111111",
      uploadedAt: UPLOADED_AT,
      declaredContentHash: DECLARED_HASH,
      storageVersion: "ver-1",
      storageEtag: "etag-not-sha256",
      finalizedAt: UPLOADED_AT,
    }),
    ...overrides,
  };
}

describe("large attachment phase 2A.1 hardening", () => {
  describe("upload session persistence schema", () => {
    it("defines persisted upload session table", () => {
      assert.match(MIGRATION_SQL, /CREATE TABLE mail_large_attachment_upload_sessions/);
      for (const col of [
        "actor_user_id",
        "draft_id",
        "mailbox_id",
        "storage_key",
        "declared_content_hash",
        "expires_at",
        "finalized_at",
        "invalidated_at",
      ]) {
        assert.match(MIGRATION_SQL, new RegExp(col));
      }
    });

    it("requires actor, draft, mailbox, expiry, and unique storage key", () => {
      assert.match(MIGRATION_SQL, /actor_user_id TEXT NOT NULL/);
      assert.match(MIGRATION_SQL, /draft_id TEXT NOT NULL/);
      assert.match(MIGRATION_SQL, /mailbox_id TEXT NOT NULL/);
      assert.match(MIGRATION_SQL, /expires_at TEXT NOT NULL/);
      assert.match(MIGRATION_SQL, /uq_mail_large_attachment_upload_sessions_storage_key/);
    });

    it("does not persist presigned URL columns", () => {
      const uploadBlock =
        MIGRATION_SQL.match(
          /CREATE TABLE mail_large_attachment_upload_sessions \([\s\S]*?\);/,
        )?.[0] ?? "";
      assert.ok(uploadBlock.length > 0);
      assert.doesNotMatch(uploadBlock, /presigned/i);
      assert.doesNotMatch(uploadBlock, /signing/i);
    });
  });

  describe("upload session domain", () => {
    it("binds actor draft and mailbox", () => {
      const s = session();
      assert.equal(
        evaluateLargeAttachmentUploadSessionValidity({
          session: s,
          actorUserId: "user-1",
          draftId: "draft-1",
          mailboxId: "mailbox-1",
          trustNowIso: UPLOADED_AT,
        }).ok,
        true,
      );
      assert.equal(
        evaluateLargeAttachmentUploadSessionValidity({
          session: s,
          actorUserId: "other",
          draftId: "draft-1",
          mailboxId: "mailbox-1",
          trustNowIso: UPLOADED_AT,
        }).ok,
        false,
      );
    });

    it("blocks invalidated and expired sessions", () => {
      const invalidated = session({
        invalidatedAt: UPLOADED_AT,
      });
      assert.equal(
        evaluateLargeAttachmentUploadSessionValidity({
          session: invalidated,
          actorUserId: "user-1",
          draftId: "draft-1",
          mailboxId: "mailbox-1",
          trustNowIso: UPLOADED_AT,
        }).ok,
        false,
      );
      const expired = session({
        expiresAt: "2026-08-30T09:00:00.000Z",
      });
      assert.equal(
        evaluateLargeAttachmentUploadSessionValidity({
          session: expired,
          actorUserId: "user-1",
          draftId: "draft-1",
          mailboxId: "mailbox-1",
          trustNowIso: UPLOADED_AT,
        }).ok,
        false,
      );
    });

    it("finalize is idempotent and rejects different object after finalize", () => {
      const s = session();
      const identity = {
        storageVersion: "v1",
        storageEtag: "etag-1",
        sizeBytes: s.expectedSizeBytes,
        finalizedAt: UPLOADED_AT,
      };
      const first = evaluateLargeAttachmentUploadFinalize({
        session: s,
        observedSizeBytes: s.expectedSizeBytes,
        observedStorageKey: s.storageKey,
        storageIdentity: identity,
        trustNowIso: UPLOADED_AT,
      });
      assert.equal(first.ok, true);
      const finalized = session({ finalizedAt: UPLOADED_AT });
      const replay = evaluateLargeAttachmentUploadFinalize({
        session: finalized,
        observedSizeBytes: finalized.expectedSizeBytes,
        observedStorageKey: finalized.storageKey,
        storageIdentity: identity,
        trustNowIso: UPLOADED_AT,
      });
      assert.equal(replay.ok, true);
      if (replay.ok) assert.equal(replay.idempotentReplay, true);
      const mismatch = evaluateLargeAttachmentUploadFinalize({
        session: finalized,
        observedSizeBytes: finalized.expectedSizeBytes,
        observedStorageKey: "mail/large-attachments/2026/08/wrong",
        storageIdentity: identity,
        trustNowIso: UPLOADED_AT,
      });
      assert.equal(mismatch.ok, false);
    });

    it("invalidated session cannot finalize", () => {
      const invalidated = invalidateLargeAttachmentUploadSession({
        session: session(),
        invalidatedAt: UPLOADED_AT,
      });
      const result = evaluateLargeAttachmentUploadFinalize({
        session: invalidated,
        observedSizeBytes: 1024,
        observedStorageKey: invalidated.storageKey,
        storageIdentity: {
          storageVersion: "v1",
          storageEtag: "etag-1",
          sizeBytes: 1024,
          finalizedAt: UPLOADED_AT,
        },
        trustNowIso: UPLOADED_AT,
      });
      assert.equal(result.ok, false);
    });

    it("asserts forbidden persisted presigned fields", () => {
      assert.throws(() =>
        assertUploadSessionHasNoPresignedUrlPersisted({ presignedPutUrl: "x" }),
      );
    });
  });

  describe("storage identity", () => {
    it("keeps content_hash distinct from storage_etag", () => {
      assert.equal(etagEqualsContentHash(DECLARED_HASH, "etag-abc"), false);
      assert.match(MIGRATION_SQL, /declared_content_hash TEXT/);
      assert.match(MIGRATION_SQL, /storage_version TEXT/);
      assert.match(MIGRATION_SQL, /storage_etag TEXT/);
    });

    it("does not require full CRM 100MiB re-read for hash", () => {
      assert.equal(LARGE_ATTACHMENT_REQUIRES_FULL_CRM_REREAD_FOR_HASH, false);
      assert.equal(
        LARGE_ATTACHMENT_CHECKSUM_ENFORCEMENT_STATUS,
        "CONTENT_MD5_TRANSPORT_V1",
      );
    });

    it("blocks send when storage identity missing", () => {
      const incomplete = lifecycle({
        storageEtag: null,
      });
      const result = evaluateLargeAttachmentSendEligibility({
        deliveryMode: "large_attachment",
        lifecycle: incomplete,
        sizeBytes: 1024,
        securityScanStatus: LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS,
        trustNowIso: UPLOADED_AT,
        uploadFinalized: true,
        allowTemporary: true,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "MISSING_STORAGE_IDENTITY");
    });

    it("allows send when storage version is deferred but etag is present", () => {
      const deferredVersion = lifecycle({
        storageVersion: null,
      });
      const result = evaluateLargeAttachmentSendEligibility({
        deliveryMode: "large_attachment",
        lifecycle: deferredVersion,
        sizeBytes: 1024,
        securityScanStatus: LARGE_ATTACHMENT_REQUIRED_SCAN_STATUS,
        trustNowIso: UPLOADED_AT,
        uploadFinalized: true,
        allowTemporary: true,
      });
      assert.equal(result.ok, true);
    });

    it("revision snapshot excludes presigned URLs and binds storage identity", () => {
      const snapshot = buildLargeAttachmentRevisionSnapshotFields({
        storedFileId: "11111111-1111-1111-1111-111111111111",
        contentHash: DECLARED_HASH,
        displayFilename: "pack.zip",
        mimeType: "application/zip",
        sizeBytes: 1024,
        sortOrder: 0,
        storageVersion: "v1",
        storageEtag: "etag-1",
      });
      assert.doesNotThrow(() => assertRevisionSnapshotHasNoMutableDownloadUrl(snapshot));
    });
  });

  describe("download architecture", () => {
    it("public Worker has no direct D1 or BUSINESS_EMAIL", () => {
      assert.throws(() => assertPublicDownloadWorkerHasNoDirectD1Binding({ DB: {} }));
      assert.throws(() =>
        assertPublicDownloadWorkerHasNoBusinessEmail({ BUSINESS_EMAIL: {} }),
      );
    });

    it("internal lookup persisted fields store hash only", () => {
      const persisted = toInternalDownloadLookupPersistedFields({
        downloadTokenHash: "c".repeat(64),
      });
      assert.ok(!("token" in persisted));
      assert.ok(!("bearerToken" in persisted));
    });

    it("denied authorization returns generic shape without raw token", () => {
      const result = sanitizeInternalDownloadAuthorizationResult({
        authorized: false,
      });
      assert.equal(result.authorized, false);
      assert.ok(!("bearerToken" in result));
    });
  });

  describe("migration classification", () => {
    it("documents data-preserving schema rebuild", () => {
      assert.match(MIGRATION_SQL, /DATA-PRESERVING SCHEMA REBUILD/i);
      assert.match(MIGRATION_SQL, /INSERT INTO mail_draft_attachments_new/);
    });
  });
});
