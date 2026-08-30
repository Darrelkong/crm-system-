/** Large Attachment retention and authorization time constants (UTC ISO timestamps in services). */

export const LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS = 24 * 60 * 60 * 1000;

export const LARGE_ATTACHMENT_APPROVAL_MAX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export const LARGE_ATTACHMENT_RECIPIENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Future browser presigned PUT authorization window. */
export const LARGE_ATTACHMENT_UPLOAD_AUTH_TTL_MS = 10 * 60 * 1000;

/** Future gateway short-lived R2 GET presign window. */
export const LARGE_ATTACHMENT_DOWNLOAD_PRESIGN_TTL_MS = 10 * 60 * 1000;

export const LARGE_ATTACHMENT_DEDICATED_BUCKET_NAME =
  "crm-mail-large-attachments" as const;

export const LARGE_ATTACHMENT_PUBLIC_DOWNLOAD_DOMAIN =
  "files.echfronthk.com" as const;

export const LARGE_ATTACHMENT_PUBLIC_DOWNLOAD_PATH_PREFIX = "/f/" as const;

export function addMillisecondsToIsoTimestamp(
  isoTimestamp: string,
  deltaMs: number,
): string {
  return new Date(Date.parse(isoTimestamp) + deltaMs).toISOString();
}

export function isIsoTimestampBeforeOrEqual(
  isoTimestamp: string,
  trustNowIso: string,
): boolean {
  return Date.parse(isoTimestamp) <= Date.parse(trustNowIso);
}
