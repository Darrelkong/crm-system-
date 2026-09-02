import { resolveMailAttachmentDownloadContentType } from "@/lib/mail/mail-attachment-download-content-type";
import { buildMailAttachmentContentDispositionHeader } from "@/lib/mail/mail-attachment-download-content-disposition";
import type { DownloadableMailAttachment } from "@/lib/mail/mail-attachment-download-service";

/**
 * Builds a binary download response with conservative headers.
 *
 * Streaming note: the ATTACHMENTS R2 binding exposes `arrayBuffer()` via the
 * byte reader. Attachments are capped at ~25 MiB by compose policy, so full
 * buffering is acceptable for V1 correctness across Next.js route handlers.
 */
export function buildMailAttachmentDownloadResponse(
  bytes: Uint8Array,
  attachment: Pick<
    DownloadableMailAttachment,
    "filename" | "mimeType" | "sizeBytes"
  >,
  options?: {
    disposition?: "inline" | "attachment";
    contentType?: string;
  },
): Response {
  const disposition = options?.disposition ?? "attachment";
  const headers = new Headers({
    "Content-Type":
      options?.contentType ??
      resolveMailAttachmentDownloadContentType(attachment.mimeType),
    "Content-Disposition": buildMailAttachmentContentDispositionHeader(
      attachment.filename,
      disposition,
    ),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });

  if (Number.isFinite(attachment.sizeBytes) && attachment.sizeBytes >= 0) {
    headers.set("Content-Length", String(bytes.byteLength));
  }

  return new Response(bytes as BodyInit, {
    status: 200,
    headers,
  });
}
