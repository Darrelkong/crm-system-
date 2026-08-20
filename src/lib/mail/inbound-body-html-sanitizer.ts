import sanitizeHtml from "sanitize-html";

/** Frozen inbound HTML policy — bump when allowlist changes (does not re-sanitize history). */
export const INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION = "inbound-v1";

const INBOUND_BODY_ALLOWED_TAGS = [
  "p",
  "div",
  "span",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
] as const;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...INBOUND_BODY_ALLOWED_TAGS],
  disallowedTagsMode: "discard",
  allowedAttributes: {
    a: ["href", "target", "rel"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: {
    a: (_tagName, attribs) => {
      const href = attribs.href?.trim();
      if (!href) return { tagName: "a", attribs: {} };
      const lower = href.toLowerCase();
      if (lower.startsWith("javascript:") || lower.startsWith("data:")) {
        return { tagName: "span", attribs: {}, text: "" };
      }
      const next: Record<string, string> = { href };
      if (attribs.target === "_blank") {
        next.target = "_blank";
        next.rel = "noopener noreferrer";
      }
      return { tagName: "a", attribs: next };
    },
  },
};

/** Deterministic plain text from sanitized HTML — no raw tags in body_text. */
export function derivePlainTextFromSanitizedHtml(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sanitizes hostile inbound MIME HTML before canonical persistence.
 * V1 strips remote images (<img>) and all executable/active content.
 */
export function sanitizeInboundBodyHtml(rawHtml: string): string | null {
  const trimmed = rawHtml.trim();
  if (!trimmed) {
    return null;
  }

  const sanitized = sanitizeHtml(trimmed, SANITIZE_OPTIONS).trim();
  if (!sanitized) {
    return null;
  }

  if (/<img\b/i.test(trimmed)) {
    const withoutImages = sanitizeHtml(trimmed, {
      allowedTags: [...INBOUND_BODY_ALLOWED_TAGS],
      disallowedTagsMode: "discard",
      allowedAttributes: SANITIZE_OPTIONS.allowedAttributes,
      allowedSchemes: SANITIZE_OPTIONS.allowedSchemes,
      allowProtocolRelative: false,
      transformTags: SANITIZE_OPTIONS.transformTags,
    }).trim();
    if (!withoutImages) {
      return null;
    }
    return withoutImages;
  }

  return sanitized;
}

export function isInboundBodySanitizerIdempotent(input: string): boolean {
  const once = sanitizeInboundBodyHtml(input);
  if (once === null) {
    return sanitizeInboundBodyHtml(input) === null;
  }
  return once === sanitizeInboundBodyHtml(once);
}
