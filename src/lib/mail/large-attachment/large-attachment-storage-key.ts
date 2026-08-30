/** Private dedicated Large Attachment object namespace — server-generated keys only. */
export const LARGE_ATTACHMENT_STORAGE_KEY_PREFIX =
  "mail/large-attachments/" as const;

const STORAGE_KEY_SEGMENT = /^[0-9a-f-]{36}$/;

export function buildLargeAttachmentStorageKey(input: {
  uploadedAt: Date;
  objectId?: string;
}): string {
  const year = input.uploadedAt.getUTCFullYear();
  const month = String(input.uploadedAt.getUTCMonth() + 1).padStart(2, "0");
  const objectId = input.objectId ?? crypto.randomUUID();
  return `${LARGE_ATTACHMENT_STORAGE_KEY_PREFIX}${year}/${month}/${objectId}`;
}

export function assertLargeAttachmentStorageKey(storageKey: string): void {
  if (!storageKey.startsWith(LARGE_ATTACHMENT_STORAGE_KEY_PREFIX)) {
    throw new Error("Invalid large attachment storage key namespace");
  }
  const suffix = storageKey.slice(LARGE_ATTACHMENT_STORAGE_KEY_PREFIX.length);
  const segments = suffix.split("/");
  if (segments.length !== 3) {
    throw new Error("Invalid large attachment storage key structure");
  }
  const [year, month, objectId] = segments;
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !STORAGE_KEY_SEGMENT.test(objectId)) {
    throw new Error("Invalid large attachment storage key segments");
  }
  if (storageKey.includes("@")) {
    throw new Error("Large attachment storage key must not contain email-like data");
  }
}

export function largeAttachmentStorageKeyContainsFilename(
  storageKey: string,
  filename: string,
): boolean {
  const normalized = filename.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return storageKey.toLowerCase().includes(normalized);
}
