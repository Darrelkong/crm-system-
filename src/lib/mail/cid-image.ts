import { imageDimension } from "./inert-image";

/** Conservative RFC msg-id dot-atom subset; deliberately case-sensitive.
 * Unsupported quoted/obsolete forms fail closed. Never truncate or repair IDs.
 */
export const MAIL_CID_NORMALIZATION_VERSION = "cid-v1";
export const MAIL_CID_ATTRIBUTE = "data-mail-cid-v1";
const ATOM = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const CID = new RegExp(`^${ATOM}(?:\\.${ATOM})*@${ATOM}(?:\\.${ATOM})*$`);

export function validNormalizedContentId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 998 && !/[^!-~]/.test(value) && CID.test(value);
}

export function normalizeContentIdHeader(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  let id = value.replace(/^[ \t]+|[ \t]+$/g, "");
  if (id.startsWith("<") && id.endsWith(">")) id = id.slice(1, -1);
  return validNormalizedContentId(id) ? id : null;
}

export function normalizeHtmlCid(value: string): string | null {
  if (!/^cid:/i.test(value)) return null;
  try {
    // decodeURIComponent does not turn '+' into space. Decode exactly once.
    const id = decodeURIComponent(value.slice(4));
    return validNormalizedContentId(id) ? id : null;
  } catch { return null; }
}

export type InertMailCid = { cid: string; alt: string; width: number | null; height: number | null };
export type MailInlineResource = { cid: string; attachmentId: string | null };
export type MailInlineContext = { messageId: string; folder?: string | null; resources: MailInlineResource[] };

export function encodeInertCid(image: InertMailCid): string {
  return encodeURIComponent(JSON.stringify([image.cid, image.alt, image.width, image.height]));
}

export function decodeInertCid(value: string): InertMailCid | null {
  if (value.length > 10000) return null;
  try {
    const data: unknown = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(data) || data.length !== 4 || !validNormalizedContentId(data[0]) || typeof data[1] !== "string" || data[1].length > 500) return null;
    if (data.slice(2).some(v => v !== null && (typeof v !== "number" || imageDimension(String(v)) !== v))) return null;
    return { cid: data[0], alt: data[1], width: data[2], height: data[3] };
  } catch { return null; }
}

export function inertMailCids(html: string): InertMailCid[] {
  const result: InertMailCid[] = [];
  for (const match of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<span\b[^>]*\sdata-mail-cid-v1="([^"<>]*)"[^>]*>/g)) {
    const image = decodeInertCid(match[1]);
    if (image) result.push(image);
  }
  return result;
}

/** Only application-generated paths; sender metadata cannot supply a URL. */
export function mailInlineResourcePath(context: MailInlineContext, cid: string): string | null {
  const matches = context.resources.filter(row => row.cid === cid);
  if (matches.length !== 1 || !matches[0].attachmentId) return null;
  return `/api/mail/messages/${encodeURIComponent(context.messageId)}/inline-resources/${encodeURIComponent(matches[0].attachmentId)}${context.folder ? `?folder=${encodeURIComponent(context.folder)}` : ""}`;
}
