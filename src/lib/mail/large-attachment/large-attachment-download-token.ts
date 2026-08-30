import { createHash, randomBytes } from "node:crypto";

export const LARGE_ATTACHMENT_TOKEN_RANDOM_BYTES = 16 as const;

export const LARGE_ATTACHMENT_PUBLIC_DOWNLOAD_DOMAIN = "files.echfronthk.com" as const;

export const LARGE_ATTACHMENT_PUBLIC_DOWNLOAD_PATH_PREFIX = "/f/" as const;

/** Minimum entropy: 16 bytes = 128 bits. */
export function encodeLargeAttachmentPublicToken(bytes: Uint8Array): string {
  if (bytes.byteLength !== LARGE_ATTACHMENT_TOKEN_RANDOM_BYTES) {
    throw new Error("Large attachment token requires exactly 16 random bytes");
  }
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function hashLargeAttachmentDownloadToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function buildLargeAttachmentPublicDownloadUrl(token: string): string {
  return `https://${LARGE_ATTACHMENT_PUBLIC_DOWNLOAD_DOMAIN}${LARGE_ATTACHMENT_PUBLIC_DOWNLOAD_PATH_PREFIX}${token}`;
}

export function generateLargeAttachmentDownloadTokenPair(
  randomBytesFn: (size: number) => Uint8Array = (size) =>
    new Uint8Array(randomBytes(size)),
): { token: string; tokenHash: string } {
  const token = encodeLargeAttachmentPublicToken(
    randomBytesFn(LARGE_ATTACHMENT_TOKEN_RANDOM_BYTES),
  );
  return {
    token,
    tokenHash: hashLargeAttachmentDownloadToken(token),
  };
}

/** Persisted lifecycle shape — hash only, never raw bearer token. */
export type LargeAttachmentLifecyclePersistedDownloadFields = {
  downloadTokenHash: string | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
};

export function toLargeAttachmentLifecyclePersistedDownloadFields(input: {
  downloadTokenHash: string;
}): LargeAttachmentLifecyclePersistedDownloadFields {
  return {
    downloadTokenHash: input.downloadTokenHash,
    downloadCount: 0,
    lastDownloadedAt: null,
  };
}

export function recordLargeAttachmentDownload(input: {
  downloadCount: number;
  lastDownloadedAt: string | null;
  downloadedAt: string;
}): Pick<
  LargeAttachmentLifecyclePersistedDownloadFields,
  "downloadCount" | "lastDownloadedAt"
> {
  return {
    downloadCount: input.downloadCount + 1,
    lastDownloadedAt: input.downloadedAt,
  };
}
