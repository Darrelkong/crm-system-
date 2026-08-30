/**
 * Large Attachment storage identity semantics (Phase 2A.1).
 *
 * content_hash: logical SHA-256 fingerprint used for revision identity and user-file consistency.
 *   May originate from client computation at authorize time until Phase 2B proves server-side
 *   checksum equivalence via R2 presigned PUT enforcement.
 *
 * storage_etag: authoritative R2 object ETag captured at finalize — NOT SHA-256 content_hash.
 * storage_version: authoritative R2 object version captured at finalize.
 */

export type LargeAttachmentDeclaredContentHash = string;

export type LargeAttachmentStorageIdentity = {
  storageVersion: string;
  storageEtag: string;
  sizeBytes: number;
  finalizedAt: string;
};

export type LargeAttachmentFinalizeStorageBinding = {
  declaredContentHash: LargeAttachmentDeclaredContentHash;
  storageIdentity: LargeAttachmentStorageIdentity;
};

export function assertDeclaredContentHashFormat(
  declaredContentHash: string,
): void {
  if (
    declaredContentHash.length !== 64 ||
    declaredContentHash !== declaredContentHash.toLowerCase() ||
    !/^[0-9a-f]{64}$/.test(declaredContentHash)
  ) {
    throw new Error("Invalid declared content hash format");
  }
}

/** ETag must never be treated as SHA-256 content_hash. */
export function etagEqualsContentHash(
  storageEtag: string,
  contentHash: string,
): boolean {
  return storageEtag.trim().toLowerCase() === contentHash.trim().toLowerCase();
}

export function assertStorageIdentityDistinctFromContentHash(input: {
  declaredContentHash: string;
  storageEtag: string;
}): void {
  if (etagEqualsContentHash(input.storageEtag, input.declaredContentHash)) {
    throw new Error(
      "Storage ETag must not be silently reinterpreted as declared content_hash",
    );
  }
}

export function hasCompleteLargeAttachmentStorageIdentity(
  input: Partial<LargeAttachmentStorageIdentity> &
    Pick<LargeAttachmentStorageIdentity, "storageVersion" | "storageEtag">,
): input is LargeAttachmentStorageIdentity {
  return (
    typeof input.storageVersion === "string" &&
    input.storageVersion.trim().length > 0 &&
    typeof input.storageEtag === "string" &&
    input.storageEtag.trim().length > 0 &&
    typeof input.sizeBytes === "number" &&
    input.sizeBytes > 0 &&
    typeof input.finalizedAt === "string" &&
    input.finalizedAt.trim().length > 0
  );
}

/**
 * Phase 2B must experimentally validate R2 presigned PUT checksum enforcement.
 * Do NOT choose unsupported headers by assumption.
 */
export const LARGE_ATTACHMENT_PRESIGNED_PUT_CHECKSUM_PHASE = "2B_R2_PROOF" as const;

export const LARGE_ATTACHMENT_CHECKSUM_ENFORCEMENT_CANDIDATES = [
  "r2_s3_checksum_enforcement_signed_with_put",
  "content_md5_if_browser_compatible",
  "documented_r2_supported_checksum_header",
] as const;

export type LargeAttachmentChecksumEnforcementCandidate =
  (typeof LARGE_ATTACHMENT_CHECKSUM_ENFORCEMENT_CANDIDATES)[number];

export const LARGE_ATTACHMENT_CHECKSUM_ENFORCEMENT_STATUS =
  "DEFERRED_TO_PHASE_2B_R2_PROOF" as const;

/** Full 100 MiB CRM Worker re-read for SHA-256 is NOT the Phase 2B design center. */
export const LARGE_ATTACHMENT_REQUIRES_FULL_CRM_REREAD_FOR_HASH = false as const;
