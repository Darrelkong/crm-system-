const DOWNLOAD_MIME_ALLOW_LIST = new Set([
  "application/octet-stream",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

export function resolveMailAttachmentDownloadContentType(
  storedMimeType: string,
): string {
  const normalized = storedMimeType.trim().toLowerCase();
  if (DOWNLOAD_MIME_ALLOW_LIST.has(normalized)) {
    return normalized;
  }
  return "application/octet-stream";
}
