/**
 * Content-MD5 is transport integrity enforcement for R2 presigned PUT only.
 * It is NOT a cryptographic content identity, authorization token, or security hash.
 */

const CONTENT_MD5_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{22}==|[A-Za-z0-9+/]{23}=|[A-Za-z0-9+/]{24})$/;

export function assertContentMd5Base64Format(contentMd5Base64: string): void {
  const normalized = contentMd5Base64.trim();
  if (!CONTENT_MD5_BASE64_PATTERN.test(normalized)) {
    throw new Error("Invalid Content-MD5 base64 format");
  }
}

export function normalizeContentMd5Base64(contentMd5Base64: string): string {
  assertContentMd5Base64Format(contentMd5Base64);
  return contentMd5Base64.trim();
}
