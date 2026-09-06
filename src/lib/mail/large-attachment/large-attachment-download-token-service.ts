import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  buildLargeAttachmentPublicDownloadUrl,
  generateLargeAttachmentDownloadTokenPair,
  LARGE_ATTACHMENT_PUBLIC_DOWNLOAD_PATH_PREFIX,
} from "./large-attachment-download-token";
import { LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME } from "./large-attachment-constants";
import { assertLargeAttachmentStorageKey } from "./large-attachment-storage-key";
import { transitionAcceptedSendToSent } from "./large-attachment-state-machine";

export type IssueLargeAttachmentDownloadTokenInput = {
  lifecycleId: string;
  storedFileId: string;
  recipientExpiresAt: string;
  sentAt: string;
  authorizationPath: "admin_direct" | "staff_approved";
  trustNowIso?: string;
};

export type IssuedLargeAttachmentDownloadToken = {
  /** Returned once to the caller that will later construct recipient content. */
  rawToken: string;
  downloadPath: string;
  downloadUrl: string;
  lifecycleId: string;
  recipientExpiresAt: string;
};

export class LargeAttachmentDownloadTokenIssuanceError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "INVALID_LINEAGE"
    | "INVALID_EXPIRY"
    | "ALREADY_ISSUED"
    | "NOT_DOWNLOADABLE";

  constructor(
    code: LargeAttachmentDownloadTokenIssuanceError["code"],
    message: string,
  ) {
    super(message);
    this.name = "LargeAttachmentDownloadTokenIssuanceError";
    this.code = code;
  }
}

function assertFutureExpiry(recipientExpiresAt: string, trustNowIso: string): void {
  const expiryMs = Date.parse(recipientExpiresAt);
  const nowMs = Date.parse(trustNowIso);
  if (
    !Number.isFinite(expiryMs) ||
    !Number.isFinite(nowMs) ||
    expiryMs <= nowMs
  ) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "INVALID_EXPIRY",
      "Recipient expiry must be a future ISO timestamp",
    );
  }
}

/**
 * Issues the opaque recipient bearer token without touching send transport.
 *
 * The caller supplies only authoritative database identities. The storage key
 * is read from mail_stored_files and is never accepted as an input.
 */
export async function issueLargeAttachmentDownloadToken(
  db: Database,
  input: IssueLargeAttachmentDownloadTokenInput,
): Promise<IssuedLargeAttachmentDownloadToken> {
  const trustNowIso = input.trustNowIso ?? new Date().toISOString();
  assertFutureExpiry(input.recipientExpiresAt, trustNowIso);

  const [lifecycle] = await db
    .select()
    .from(schema.mailLargeAttachmentLifecycle)
    .where(
      and(
        eq(schema.mailLargeAttachmentLifecycle.id, input.lifecycleId),
        eq(
          schema.mailLargeAttachmentLifecycle.storedFileId,
          input.storedFileId,
        ),
      ),
    )
    .limit(1);

  if (!lifecycle) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "NOT_FOUND",
      "Large attachment lifecycle was not found",
    );
  }
  if (lifecycle.status !== "temporary" && lifecycle.status !== "approval_hold") {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "NOT_DOWNLOADABLE",
      "Only an accepted temporary or approval-held lifecycle can receive a recipient token",
    );
  }
  if (lifecycle.downloadTokenHash) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "ALREADY_ISSUED",
      "A recipient token has already been issued",
    );
  }
  if (
    (input.authorizationPath === "admin_direct" &&
      lifecycle.status !== "temporary") ||
    (input.authorizationPath === "staff_approved" &&
      lifecycle.status !== "approval_hold")
  ) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "NOT_DOWNLOADABLE",
      "Authorization path does not match lifecycle state",
    );
  }
  if (!Number.isFinite(Date.parse(input.sentAt))) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "INVALID_EXPIRY",
      "Sent timestamp must be a valid ISO timestamp",
    );
  }
  if (
    !lifecycle.storageEtag ||
    lifecycle.declaredContentHash === null
  ) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "INVALID_LINEAGE",
      "Lifecycle storage identity is incomplete",
    );
  }

  const [storedFile] = await db
    .select()
    .from(schema.mailStoredFiles)
    .where(eq(schema.mailStoredFiles.id, input.storedFileId))
    .limit(1);

  if (!storedFile) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "NOT_FOUND",
      "Stored file was not found",
    );
  }
  if (
    storedFile.storageProvider !== "r2" ||
    storedFile.storageBucket !== LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME ||
    lifecycle.declaredContentHash !== storedFile.contentHash
  ) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "INVALID_LINEAGE",
      "Stored file lineage is invalid",
    );
  }
  try {
    assertLargeAttachmentStorageKey(storedFile.storageKey);
  } catch {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "INVALID_LINEAGE",
      "Stored file storage identity is invalid",
    );
  }

  const [revisionAttachment] = await db
    .select({ id: schema.mailOutboundRevisionAttachments.id })
    .from(schema.mailOutboundRevisionAttachments)
    .where(
      and(
        eq(
          schema.mailOutboundRevisionAttachments.storedFileId,
          storedFile.id,
        ),
        eq(
          schema.mailOutboundRevisionAttachments.contentHash,
          storedFile.contentHash,
        ),
        eq(
          schema.mailOutboundRevisionAttachments.deliveryMode,
          "large_attachment",
        ),
      ),
    )
    .limit(1);

  const [messageAttachment] = revisionAttachment
    ? []
    : await db
        .select({ id: schema.mailMessageAttachments.id })
        .from(schema.mailMessageAttachments)
        .where(
          and(
            eq(schema.mailMessageAttachments.storedFileId, storedFile.id),
            eq(schema.mailMessageAttachments.contentHash, storedFile.contentHash),
            eq(schema.mailMessageAttachments.deliveryMode, "large_attachment"),
          ),
        )
        .limit(1);

  if (!revisionAttachment && !messageAttachment) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "INVALID_LINEAGE",
      "No large-attachment revision lineage exists",
    );
  }

  const pair = generateLargeAttachmentDownloadTokenPair();
  const transitioned = transitionAcceptedSendToSent(lifecycle, {
    sentAt: input.sentAt,
    downloadTokenHash: pair.tokenHash,
    authorizationPath: input.authorizationPath,
  });
  if (transitioned.recipientExpiresAt !== input.recipientExpiresAt) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "INVALID_EXPIRY",
      "Recipient expiry does not match the authoritative retention policy",
    );
  }
  const updated = await db
    .update(schema.mailLargeAttachmentLifecycle)
    .set({
      status: transitioned.status,
      sentAt: transitioned.sentAt,
      recipientExpiresAt: transitioned.recipientExpiresAt,
      downloadTokenHash: pair.tokenHash,
      temporaryExpiresAt: transitioned.temporaryExpiresAt,
      updatedAt: transitioned.updatedAt,
    })
    .where(
      and(
        eq(schema.mailLargeAttachmentLifecycle.id, lifecycle.id),
        isNull(schema.mailLargeAttachmentLifecycle.downloadTokenHash),
      ),
    )
    .returning({ id: schema.mailLargeAttachmentLifecycle.id });

  if (updated.length !== 1) {
    throw new LargeAttachmentDownloadTokenIssuanceError(
      "ALREADY_ISSUED",
      "A recipient token has already been issued",
    );
  }

  const downloadPath = `${LARGE_ATTACHMENT_PUBLIC_DOWNLOAD_PATH_PREFIX}${pair.token}`;
  return {
    rawToken: pair.token,
    downloadPath,
    downloadUrl: buildLargeAttachmentPublicDownloadUrl(pair.token),
    lifecycleId: lifecycle.id,
    recipientExpiresAt: transitioned.recipientExpiresAt,
  };
}

export function isRecipientDownloadExpired(
  recipientExpiresAt: string,
  trustNowIso: string,
): boolean {
  const expiryMs = Date.parse(recipientExpiresAt);
  const nowMs = Date.parse(trustNowIso);
  return (
    !Number.isFinite(expiryMs) ||
    !Number.isFinite(nowMs) ||
    expiryMs <= nowMs
  );
}
