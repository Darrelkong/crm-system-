import { inertMailImages } from "../inert-image";

/** Input is server-sanitized canonical HTML, never raw MIME or compose input. */
export const MAIL_DOCUMENT_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function buildMailIsolatedDocument(sanitizedHtml: string, loadImages = false, allowInlineImages = false): string {
  // Only image origins explicitly represented by this canonical body are permitted
  // after opt-in. Exact URLs are selected by trusted parent code, never sender code.
  const origins = [...new Set(inertMailImages(sanitizedHtml).map(image => new URL(image.url).origin))];
  const sources = [...(allowInlineImages ? ["'self'"] : []), ...(loadImages ? origins : [])];
  const csp = sources.length ? MAIL_DOCUMENT_CSP.replace("img-src 'none'", `img-src ${sources.join(" ")}`) : MAIL_DOCUMENT_CSP;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>html{overflow:hidden}body{margin:0;display:flow-root;background:white;color:#111;font:16px/1.5 Arial,sans-serif}body> :first-child{margin-top:0}body> :last-child{margin-bottom:0}</style></head><body data-mail-document data-mail-images="${loadImages ? "enabled" : "blocked"}">${sanitizedHtml}</body></html>`;
}

export function safeMailDocumentLink(href: string): string | null {
  if (!/^(https?:\/\/|mailto:|tel:)/i.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return null;
  try { const url = new URL(href); return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
