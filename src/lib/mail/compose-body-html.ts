import sanitizeHtml from "sanitize-html";
import { sanitizeInboundBodyHtml, INBOUND_BODY_ALLOWED_TAGS } from "./inbound-body-html-sanitizer";
import { sanitizeOptionalOutboundBodyHtml } from "./outbound-body-html-sanitizer";
import { MAIL_CID_ATTRIBUTE, decodeInertCid } from "./cid-image";
import { MAIL_IMAGE_ATTRIBUTE, decodeInertImage } from "./inert-image";
import { splitComposeBodyForEditor, mergeComposeBodyForSave, type ComposeBodyMode } from "./client/compose-reply-body";

/** M1F quote-v1: accepted inbound presentation, without outbound image delivery.
 * Draft descriptors remain inert. Immutable revisions contain descriptions only;
 * private resource URLs and remote tracking descriptors never leave the reader.
 * Editable/new content retains the existing outbound policy.
 */
export function sanitizeQuoteHtml(html: string, forDelivery = false): string | null {
  const safe = sanitizeInboundBodyHtml(html);
  if (!safe || !forDelivery) return safe;
  return sanitizeHtml(safe, {
    // Only the already-sanitized inbound result enters this transformation.
    allowedTags: [...INBOUND_BODY_ALLOWED_TAGS],
    allowedAttributes: false,
    transformTags: {
      span: (tagName, attribs) => {
        const cid = decodeInertCid(attribs[MAIL_CID_ATTRIBUTE] ?? "");
        const remote = decodeInertImage(attribs[MAIL_IMAGE_ATTRIBUTE] ?? "");
        const image = cid ?? remote;
        return image
          ? { tagName, attribs: {}, text: `[${cid ? "Inline image" : "Remote image"} not included]${image.alt ? ` ${image.alt}` : ""}` }
          : { tagName, attribs };
      },
    },
  });
}

export function sanitizeComposeBodyHtml(
  html: string | null | undefined,
  mode: ComposeBodyMode,
  forDelivery = false,
): string | null {
  if (!html?.trim()) return null;
  const split = splitComposeBodyForEditor({ bodyHtml: html, composeMode: mode });
  if (!split.quotedHtml) return sanitizeOptionalOutboundBodyHtml(html);
  return mergeComposeBodyForSave({
    editableHtml: sanitizeOptionalOutboundBodyHtml(split.editableHtml) ?? "",
    quotedHtml: sanitizeQuoteHtml(split.quotedHtml, forDelivery),
    composeMode: mode,
  });
}
