import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { MailSignatureVersion } from "../../../drizzle/schema/mail-signature-versions";
import type { MailSignatureVersionAsset } from "../../../drizzle/schema/mail-signature-version-assets";
import { schema, type Database } from "@/lib/db";
import { findSenderIdentityById } from "@/lib/mail/sender-identity-service";
import { MailServiceError } from "@/lib/mail/errors";
import {
  buildCanonicalContentHashV1Payload,
  deterministicCanonicalJsonStringify,
  normalizeAssetRef,
  normalizeBodyString,
  normalizeMimeType,
} from "@/lib/mail/canonical-content-hash-v1-contract";

export type SignatureSnapshotMaterialization = {
  snapshotId: string;
  senderIdentityId: string;
  sourceSignatureVersionId: string | null;
  bodyText: string;
  bodyHtmlSanitized: string | null;
  snapshotHash: string;
  assets: Array<{
    id: string;
    storedFileId: string;
    contentHash: string;
    assetRef: string;
    mimeType: string;
    sizeBytes: number;
    sortOrder: number;
  }>;
};

async function findActiveSignatureVersion(
  db: Database,
  senderIdentityId: string,
): Promise<MailSignatureVersion | null> {
  const [row] = await db
    .select()
    .from(schema.mailSignatureVersions)
    .where(
      and(
        eq(schema.mailSignatureVersions.senderIdentityId, senderIdentityId),
        eq(schema.mailSignatureVersions.isActive, 1),
      ),
    )
    .limit(1);
  return row ?? null;
}

function computeSignatureSnapshotHash(input: {
  bodyText: string;
  bodyHtmlSanitized: string | null;
  assets: Array<{
    assetRef: string;
    contentHash: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}): string {
  const payload = {
    body_text: normalizeBodyString(input.bodyText),
    body_html_sanitized: normalizeBodyString(input.bodyHtmlSanitized),
    assets: input.assets
      .map((asset) => ({
        asset_ref: normalizeAssetRef(asset.assetRef),
        content_hash: asset.contentHash.toLowerCase(),
        mime_type: normalizeMimeType(asset.mimeType),
        size_bytes: asset.sizeBytes,
      }))
      .sort((a, b) => {
        if (a.asset_ref !== b.asset_ref) return a.asset_ref < b.asset_ref ? -1 : 1;
        if (a.content_hash !== b.content_hash) {
          return a.content_hash < b.content_hash ? -1 : 1;
        }
        if (a.mime_type !== b.mime_type) return a.mime_type < b.mime_type ? -1 : 1;
        return a.size_bytes - b.size_bytes;
      }),
  };
  const json = deterministicCanonicalJsonStringify(payload);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

export async function materializeSignatureSnapshotForRevision(
  db: Database,
  senderIdentityId: string,
): Promise<SignatureSnapshotMaterialization> {
  const identity = await findSenderIdentityById(db, senderIdentityId);
  if (!identity) {
    throw MailServiceError.notFound("Sender identity not found");
  }

  const activeVersion = await findActiveSignatureVersion(db, senderIdentityId);
  const snapshotId = crypto.randomUUID();

  if (!activeVersion) {
    const snapshotHash = computeSignatureSnapshotHash({
      bodyText: "",
      bodyHtmlSanitized: null,
      assets: [],
    });
    return {
      snapshotId,
      senderIdentityId,
      sourceSignatureVersionId: null,
      bodyText: "",
      bodyHtmlSanitized: null,
      snapshotHash,
      assets: [],
    };
  }

  const versionAssets = await db
    .select()
    .from(schema.mailSignatureVersionAssets)
    .where(
      eq(schema.mailSignatureVersionAssets.signatureVersionId, activeVersion.id),
    )
    .orderBy(schema.mailSignatureVersionAssets.sortOrder);

  const assets = versionAssets.map((asset: MailSignatureVersionAsset) => ({
    id: crypto.randomUUID(),
    storedFileId: asset.storedFileId,
    contentHash: asset.contentHash,
    assetRef: asset.assetRef,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    sortOrder: asset.sortOrder,
  }));

  const snapshotHash = computeSignatureSnapshotHash({
    bodyText: activeVersion.bodyText,
    bodyHtmlSanitized: activeVersion.bodyHtmlSanitized,
    assets: assets.map((asset) => ({
      assetRef: asset.assetRef,
      contentHash: asset.contentHash,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
    })),
  });

  return {
    snapshotId,
    senderIdentityId,
    sourceSignatureVersionId: activeVersion.id,
    bodyText: activeVersion.bodyText,
    bodyHtmlSanitized: activeVersion.bodyHtmlSanitized,
    snapshotHash,
    assets,
  };
}
