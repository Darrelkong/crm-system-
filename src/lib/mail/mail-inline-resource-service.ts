import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "./actor-context";
import { inertMailCids, validNormalizedContentId, type MailInlineResource } from "./cid-image";
import { MailServiceError } from "./errors";
import { assertCanReadMessageForPublicApi, type MailMessageReadContext } from "./message-read-permissions";
import { resolveDownloadableMailAttachment } from "./mail-attachment-download-service";
import { resolveMailAttachmentDownloadable, resolveMailAttachmentPreviewContentType } from "./mail-attachment-preview";

type ResourceRow = {
  attachment: { id: string; contentIdNormalized: string | null; contentDisposition: string | null; deliveryMode: string; mimeType: string };
  securityScanStatus: string | null;
  trustedMimeType: string | null;
};

export function isInlineImageMime(mime: string | null): mime is "image/png" | "image/jpeg" {
  return mime === "image/png" || mime === "image/jpeg";
}

/** Called only after message authorization. Count every duplicate before eligibility.
 * One bounded map for the body, without file locators or unrelated CID metadata.
 */
export function buildMailInlineResourceMap(html: string, rows: ResourceRow[]): MailInlineResource[] {
  const byCid = new Map<string, ResourceRow | null>();
  for (const row of rows) {
    const cid = row.attachment.contentIdNormalized;
    if (cid !== null) byCid.set(cid, byCid.has(cid) ? null : row);
  }
  return [...new Set(inertMailCids(html).map(image => image.cid))].slice(0, 256).map(cid => {
    const row = byCid.get(cid) ?? null;
    const eligible = row && isInlineImageMime(row.trustedMimeType) && row.trustedMimeType === row.attachment.mimeType &&
      (row.attachment.contentDisposition === "inline" || row.attachment.contentDisposition === "attachment") &&
      row.securityScanStatus !== null && resolveMailAttachmentDownloadable({ deliveryMode: row.attachment.deliveryMode, securityScanStatus: row.securityScanStatus });
    return { cid, attachmentId: eligible ? row.attachment.id : null };
  });
}

export async function resolveMailInlineResource(db: Database, actor: MailActorContext, messageId: string, attachmentId: string, context?: MailMessageReadContext) {
  await assertCanReadMessageForPublicApi(db, actor, messageId, context);
  const [attachment] = await db.select().from(schema.mailMessageAttachments)
    .where(and(eq(schema.mailMessageAttachments.id, attachmentId), eq(schema.mailMessageAttachments.messageId, messageId))).limit(1);
  if (!attachment || !validNormalizedContentId(attachment.contentIdNormalized)) throw MailServiceError.notFound();
  // BINARY column comparison, with duplicates counted before MIME/disposition checks.
  const matches = await db.select({ id: schema.mailMessageAttachments.id }).from(schema.mailMessageAttachments)
    .where(and(eq(schema.mailMessageAttachments.messageId, messageId), eq(schema.mailMessageAttachments.contentIdNormalized, attachment.contentIdNormalized))).limit(2);
  if (matches.length !== 1 || !["inline", "attachment"].includes(attachment.contentDisposition ?? "")) throw MailServiceError.notFound();
  const downloadable = await resolveDownloadableMailAttachment(db, actor, attachmentId, context);
  if (!isInlineImageMime(downloadable.mimeType) || attachment.mimeType !== downloadable.mimeType) throw MailServiceError.notFound();
  return downloadable;
}

/** Existing signature detector, restricted to matching declared PNG/JPEG only. */
export function validatedInlineImageType(bytes: Uint8Array, mimeType: string): string | null {
  if (!isInlineImageMime(mimeType)) return null;
  const result = resolveMailAttachmentPreviewContentType({ bytes, mimeType, filename: "" });
  return result?.contentType === mimeType ? mimeType : null;
}
