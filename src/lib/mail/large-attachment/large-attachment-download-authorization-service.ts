import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME,
} from "./large-attachment-constants";
import {
  sanitizeInternalDownloadAuthorizationResult,
  type LargeAttachmentInternalDownloadAuthorizationDenied,
  type LargeAttachmentInternalDownloadAuthorizationGranted,
} from "./large-attachment-download-authorization";
import { resolveMailAttachmentDownloadFilename } from "../mail-attachment-download-content-disposition";
import { assertLargeAttachmentStorageKey } from "./large-attachment-storage-key";

const SHA256_HEX = /^[0-9a-f]{64}$/;

type GatewayLifecycleIdentity = Pick<
  typeof schema.mailLargeAttachmentLifecycle.$inferSelect,
  | "id"
  | "storedFileId"
  | "status"
  | "recipientExpiresAt"
  | "downloadTokenHash"
  | "declaredContentHash"
  | "storageVersion"
  | "storageEtag"
  | "downloadCount"
>;

type GatewayStoredFileIdentity = Pick<
  typeof schema.mailStoredFiles.$inferSelect,
  | "id"
  | "contentHash"
  | "originalFilename"
  | "mimeType"
  | "sizeBytes"
  | "storageProvider"
  | "storageBucket"
  | "storageKey"
  | "securityScanStatus"
>;

type GatewayUsageIdentity = {
  storedFileId: string;
  contentHash: string;
  displayFilename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  deliveryMode: string;
};

export type LargeAttachmentGatewayAuthorizationIdentity = {
  lifecycle: GatewayLifecycleIdentity;
  storedFile: GatewayStoredFileIdentity;
  usage: GatewayUsageIdentity;
};

export type LargeAttachmentGatewayAuthorizationRepository = {
  findByTokenHash(
    tokenHash: string,
  ): Promise<LargeAttachmentGatewayAuthorizationIdentity | null>;
  recordDownload(input: {
    lifecycleId: string;
    tokenHash: string;
    downloadedAt: string;
  }): Promise<boolean>;
};

type GatewayAuthorizationDenied =
  LargeAttachmentInternalDownloadAuthorizationDenied;

export function denyLargeAttachmentPublicDownload(): GatewayAuthorizationDenied {
  return { authorized: false };
}

/**
 * Pure fail-closed validation used by both the D1 repository and tests.
 * It deliberately does not accept a storage key as an input.
 */
export function evaluateLargeAttachmentGatewayAuthorization(input: {
  identity: LargeAttachmentGatewayAuthorizationIdentity | null;
  tokenHash: string;
  trustNowIso: string;
}):
  | LargeAttachmentInternalDownloadAuthorizationGranted
  | LargeAttachmentInternalDownloadAuthorizationDenied {
  if (!SHA256_HEX.test(input.tokenHash)) {
    return denyLargeAttachmentPublicDownload();
  }
  if (!Number.isFinite(Date.parse(input.trustNowIso))) {
    return denyLargeAttachmentPublicDownload();
  }

  const identity = input.identity;
  if (!identity) {
    return denyLargeAttachmentPublicDownload();
  }

  const { lifecycle, storedFile, usage } = identity;
  const recipientExpiryMs = Date.parse(lifecycle.recipientExpiresAt ?? "");
  const trustNowMs = Date.parse(input.trustNowIso);
  if (
    lifecycle.downloadTokenHash !== input.tokenHash ||
    lifecycle.status !== "sent" ||
    !lifecycle.recipientExpiresAt ||
    !Number.isFinite(recipientExpiryMs) ||
    !Number.isFinite(trustNowMs) ||
    recipientExpiryMs <= trustNowMs
  ) {
    return denyLargeAttachmentPublicDownload();
  }
  if (
    !lifecycle.storageEtag ||
    lifecycle.storedFileId !== storedFile.id ||
    lifecycle.declaredContentHash !== storedFile.contentHash ||
    storedFile.id !== usage.storedFileId ||
    storedFile.contentHash !== usage.contentHash ||
    usage.deliveryMode !== "large_attachment" ||
    usage.sizeBytes !== storedFile.sizeBytes ||
    usage.mimeType !== storedFile.mimeType
  ) {
    return denyLargeAttachmentPublicDownload();
  }
  if (
    storedFile.storageProvider !== "r2" ||
    storedFile.storageBucket !== LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME ||
    storedFile.securityScanStatus === "blocked" ||
    storedFile.securityScanStatus === "scan_failed"
  ) {
    return denyLargeAttachmentPublicDownload();
  }
  try {
    assertLargeAttachmentStorageKey(storedFile.storageKey);
  } catch {
    return denyLargeAttachmentPublicDownload();
  }

  return sanitizeInternalDownloadAuthorizationResult({
    authorized: true,
    lifecycleId: lifecycle.id,
    storageKey: storedFile.storageKey,
    filename: resolveMailAttachmentDownloadFilename({
      displayFilename: usage.displayFilename,
      originalFilename: usage.originalFilename,
    }),
    mimeType: storedFile.mimeType,
    sizeBytes: storedFile.sizeBytes,
    storageVersion: lifecycle.storageVersion,
    storageEtag: lifecycle.storageEtag,
    recipientExpiresAt: lifecycle.recipientExpiresAt,
  });
}

export async function authorizeLargeAttachmentPublicDownload(
  repository: LargeAttachmentGatewayAuthorizationRepository,
  input: { tokenHash: string; trustNowIso: string },
): Promise<
  | LargeAttachmentInternalDownloadAuthorizationGranted
  | LargeAttachmentInternalDownloadAuthorizationDenied
> {
  const identity = await repository.findByTokenHash(input.tokenHash);
  return evaluateLargeAttachmentGatewayAuthorization({
    identity,
    ...input,
  });
}

export async function recordLargeAttachmentPublicDownload(
  repository: LargeAttachmentGatewayAuthorizationRepository,
  input: { lifecycleId: string; tokenHash: string; downloadedAt: string },
): Promise<{ recorded: boolean }> {
  if (
    !input.lifecycleId ||
    !SHA256_HEX.test(input.tokenHash) ||
    !Number.isFinite(Date.parse(input.downloadedAt))
  ) {
    return { recorded: false };
  }
  return {
    recorded: await repository.recordDownload(input),
  };
}

export function createLargeAttachmentGatewayAuthorizationRepository(
  db: Database,
): LargeAttachmentGatewayAuthorizationRepository {
  return {
    async findByTokenHash(tokenHash) {
      const [lifecycle] = await db
        .select()
        .from(schema.mailLargeAttachmentLifecycle)
        .where(eq(schema.mailLargeAttachmentLifecycle.downloadTokenHash, tokenHash))
        .limit(1);
      if (!lifecycle) {
        return null;
      }

      const [storedFile] = await db
        .select()
        .from(schema.mailStoredFiles)
        .where(eq(schema.mailStoredFiles.id, lifecycle.storedFileId))
        .limit(1);
      if (!storedFile) {
        return null;
      }

      const [revisionUsage] = await db
        .select({
          storedFileId: schema.mailOutboundRevisionAttachments.storedFileId,
          contentHash: schema.mailOutboundRevisionAttachments.contentHash,
          displayFilename: schema.mailOutboundRevisionAttachments.displayFilename,
          originalFilename: schema.mailOutboundRevisionAttachments.originalFilename,
          mimeType: schema.mailOutboundRevisionAttachments.mimeType,
          sizeBytes: schema.mailOutboundRevisionAttachments.sizeBytes,
          deliveryMode: schema.mailOutboundRevisionAttachments.deliveryMode,
        })
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
          ),
        )
        .limit(1);

      const [messageUsage] = revisionUsage
        ? []
        : await db
            .select({
              storedFileId: schema.mailMessageAttachments.storedFileId,
              contentHash: schema.mailMessageAttachments.contentHash,
              displayFilename: schema.mailMessageAttachments.displayFilename,
              originalFilename: schema.mailMessageAttachments.originalFilename,
              mimeType: schema.mailMessageAttachments.mimeType,
              sizeBytes: schema.mailMessageAttachments.sizeBytes,
              deliveryMode: schema.mailMessageAttachments.deliveryMode,
            })
            .from(schema.mailMessageAttachments)
            .where(
              and(
                eq(schema.mailMessageAttachments.storedFileId, storedFile.id),
                eq(
                  schema.mailMessageAttachments.contentHash,
                  storedFile.contentHash,
                ),
              ),
            )
            .limit(1);

      const usage = revisionUsage ?? messageUsage;
      if (!usage) {
        return null;
      }

      return {
        lifecycle: {
          id: lifecycle.id,
          storedFileId: lifecycle.storedFileId,
          status: lifecycle.status,
          recipientExpiresAt: lifecycle.recipientExpiresAt,
          downloadTokenHash: lifecycle.downloadTokenHash,
          declaredContentHash: lifecycle.declaredContentHash,
          storageVersion: lifecycle.storageVersion,
          storageEtag: lifecycle.storageEtag,
          downloadCount: lifecycle.downloadCount,
        },
        storedFile: {
          id: storedFile.id,
          contentHash: storedFile.contentHash,
          originalFilename: storedFile.originalFilename,
          mimeType: storedFile.mimeType,
          sizeBytes: storedFile.sizeBytes,
          storageProvider: storedFile.storageProvider,
          storageBucket: storedFile.storageBucket,
          storageKey: storedFile.storageKey,
          securityScanStatus: storedFile.securityScanStatus,
        },
        usage,
      };
    },

    async recordDownload({ lifecycleId, tokenHash, downloadedAt }) {
      const updated = await db
        .update(schema.mailLargeAttachmentLifecycle)
        .set({
          downloadCount: sql`${schema.mailLargeAttachmentLifecycle.downloadCount} + 1`,
          lastDownloadedAt: downloadedAt,
          updatedAt: downloadedAt,
        })
        .where(
          and(
            eq(schema.mailLargeAttachmentLifecycle.id, lifecycleId),
            eq(schema.mailLargeAttachmentLifecycle.downloadTokenHash, tokenHash),
            eq(schema.mailLargeAttachmentLifecycle.status, "sent"),
          ),
        )
        .returning({ id: schema.mailLargeAttachmentLifecycle.id });
      return updated.length === 1;
    },
  };
}
