import { MailServiceError } from "@/lib/mail/errors";

export { sanitizeOptionalSignatureHtml, sanitizeSignatureHtml } from "@/lib/mail/signature-html-sanitizer";

/** Trusted production HTML sanitizer integrated via sanitize-html (pure JS, no DOM). */
export const SIGNATURE_HTML_SANITIZER_AVAILABLE = true;

/** V1 image MIME allowlist for signature version assets (policy decision). */
export const SIGNATURE_ASSET_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

/**
 * Inline `<img>` embedding in signature HTML is deferred until asset_ref placeholder
 * convention is frozen. Relational assets via mail_signature_version_assets remain supported.
 */
export const INLINE_SIGNATURE_ASSET_REFERENCE_POLICY = "NOT_YET_FROZEN" as const;

export function assertSignatureAssetMimeType(mimeType: string): void {
  const normalized = mimeType.toLowerCase();
  if (
    !(SIGNATURE_ASSET_IMAGE_MIME_TYPES as readonly string[]).includes(normalized)
  ) {
    throw MailServiceError.validation(
      "Signature assets must be image/jpeg, image/png, image/gif, or image/webp",
    );
  }
}
