import type { MailSignatureVersion } from "../../../drizzle/schema/mail-signature-versions";
import type { MailSignatureVersionAsset } from "../../../drizzle/schema/mail-signature-version-assets";

export type SafeSignatureVersionView = {
  id: string;
  senderIdentityId: string;
  versionNumber: number;
  bodyText: string;
  bodyHtmlSanitized: string | null;
  hasHtml: boolean;
  isActive: boolean;
  createdByUserId: string | null;
  createdAt: string;
  retiredAt: string | null;
  retiredByUserId: string | null;
};

export type SafeSignatureVersionAssetView = {
  id: string;
  signatureVersionId: string;
  assetRef: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
};

export function toSafeSignatureVersionView(
  version: MailSignatureVersion,
): SafeSignatureVersionView {
  return {
    id: version.id,
    senderIdentityId: version.senderIdentityId,
    versionNumber: version.versionNumber,
    bodyText: version.bodyText,
    bodyHtmlSanitized: version.bodyHtmlSanitized,
    hasHtml: Boolean(version.bodyHtmlSanitized?.trim()),
    isActive: version.isActive === 1,
    createdByUserId: version.createdByUserId,
    createdAt: version.createdAt,
    retiredAt: version.retiredAt,
    retiredByUserId: version.retiredByUserId,
  };
}

export function toSafeSignatureVersionAssetView(
  asset: MailSignatureVersionAsset,
): SafeSignatureVersionAssetView {
  return {
    id: asset.id,
    signatureVersionId: asset.signatureVersionId,
    assetRef: asset.assetRef,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    sortOrder: asset.sortOrder,
  };
}

export type SafeEffectiveSignatureView = SafeSignatureVersionView & {
  assets: SafeSignatureVersionAssetView[];
};
