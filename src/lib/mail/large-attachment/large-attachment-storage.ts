import type { MailLargeAttachmentLifecycleStatus } from "../../../../drizzle/schema/mail-large-attachment-lifecycle";
import type { LargeAttachmentLifecycleRecord } from "@/lib/mail/large-attachment/large-attachment-state-machine";

export type LargeAttachmentObjectHeadResult = {
  storageKey: string;
  sizeBytes: number;
  etag: string | null;
  contentType: string | null;
  storageVersion?: string | null;
};

/**
 * Future dedicated-bucket storage adapter boundary.
 * Phase 2A: interfaces only — no R2 binding calls.
 */
export interface LargeAttachmentStorageAdapter {
  headLargeAttachmentObject(
    storageKey: string,
  ): Promise<LargeAttachmentObjectHeadResult | null>;

  deleteLargeAttachmentObject(storageKey: string): Promise<"deleted" | "already_missing">;

  getLargeAttachmentObjectMetadata(
    storageKey: string,
  ): Promise<LargeAttachmentObjectHeadResult | null>;

  /** Future: mint single-object PUT presign bound to upload session. Not implemented in Phase 2A. */
  createLargeAttachmentUploadAuthorization?(
    input: unknown,
  ): Promise<{ presignedPutUrl: string; expiresAt: string }>;
}

/**
 * Checksum strategy note:
 * - mail_stored_files.content_hash remains authoritative SHA-256 of bytes.
 * - R2 ETag is NOT treated as SHA-256 equivalent without proof.
 * - Future finalize must verify via server-side read or proven checksum metadata.
 */
export type LargeAttachmentChecksumVerificationStrategy =
  | "sha256_full_read_pending_implementation"
  | "declared_digest_plus_constraints_pending_implementation";

export const LARGE_ATTACHMENT_CHECKSUM_VERIFICATION_STRATEGY: LargeAttachmentChecksumVerificationStrategy =
  "sha256_full_read_pending_implementation";

export type LargeAttachmentCleanupCandidate = {
  lifecycle: LargeAttachmentLifecycleRecord;
  storageKey: string;
  cleanupClass:
    | "temporary_expired"
    | "approval_hold_expired"
    | "sent_recipient_expired"
    | "deleted_pending_object_removal"
    | "revoked_pending_object_removal";
};

export type LargeAttachmentCleanupQuery = {
  status: MailLargeAttachmentLifecycleStatus;
  expiresBeforeIso: string;
};

export const LARGE_ATTACHMENT_CLEANUP_QUERIES = {
  temporaryExpired: (trustNowIso: string): LargeAttachmentCleanupQuery => ({
    status: "temporary",
    expiresBeforeIso: trustNowIso,
  }),
  approvalHoldExpired: (trustNowIso: string): LargeAttachmentCleanupQuery => ({
    status: "approval_hold",
    expiresBeforeIso: trustNowIso,
  }),
  sentRecipientExpired: (trustNowIso: string): LargeAttachmentCleanupQuery => ({
    status: "sent",
    expiresBeforeIso: trustNowIso,
  }),
} as const;

/** Idempotent cleanup intent — DB is canonical; R2 delete may retry safely. */
export function buildLargeAttachmentCleanupCandidate(input: {
  lifecycle: LargeAttachmentLifecycleRecord;
  storageKey: string;
  cleanupClass: LargeAttachmentCleanupCandidate["cleanupClass"];
}): LargeAttachmentCleanupCandidate {
  return input;
}
