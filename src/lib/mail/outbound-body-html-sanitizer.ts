import sanitizeHtml from "sanitize-html";
import { MailServiceError } from "@/lib/mail/errors";

/** Separate from signature HTML policy — compose body allowlist. No inline images. */
const OUTBOUND_BODY_ALLOWED_TAGS = [
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
] as const;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...OUTBOUND_BODY_ALLOWED_TAGS],
  disallowedTagsMode: "discard",
  allowedAttributes: {
    "*": ["style"],
    a: ["href", "target", "rel"],
  },
  allowedStyles: {
    "*": {
      color: [
        /^#[0-9a-fA-F]{3,8}$/,
        /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/,
      ],
      "font-size": [/^\d+(?:\.\d+)?(?:px|pt|em|%)$/],
      "font-weight": [/^(?:normal|bold|lighter|bolder|[1-9]00)$/],
      "font-style": [/^(?:normal|italic|oblique)$/],
      "text-decoration": [/^(?:none|underline|line-through|overline)$/],
      "text-align": [/^(?:left|right|center|justify)$/],
    },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: {
    a: (_tagName, attribs) => {
      const href = attribs.href?.trim();
      if (!href) return { tagName: "a", attribs: {} };
      const next: Record<string, string> = { href };
      if (attribs.target === "_blank") {
        next.target = "_blank";
        next.rel = "noopener noreferrer";
      }
      return { tagName: "a", attribs: next };
    },
  },
};

function stripHtmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}

/** Rejects data:/cid: and inline images per frozen V1 compose policy. */
export function sanitizeOutboundBodyHtml(rawHtml: string): string {
  const trimmed = rawHtml.trim();
  if (!trimmed) {
    throw MailServiceError.validation("Body HTML cannot be empty");
  }
  if (/data:/i.test(trimmed) || /cid:/i.test(trimmed)) {
    throw MailServiceError.validation(
      "Inline body images are not supported in this phase",
    );
  }

  const sanitized = sanitizeHtml(trimmed, SANITIZE_OPTIONS).trim();
  if (!sanitized || !stripHtmlToText(sanitized)) {
    throw MailServiceError.validation(
      "Body HTML contained no safe content after sanitization",
    );
  }
  if (/<img\b/i.test(sanitized)) {
    throw MailServiceError.validation(
      "Inline body images are not supported in this phase",
    );
  }
  return sanitized;
}

export function sanitizeOptionalOutboundBodyHtml(
  rawHtml: string | null | undefined,
): string | null {
  const trimmed = rawHtml?.trim();
  if (!trimmed) return null;
  return sanitizeOutboundBodyHtml(trimmed);
}

export function isOutboundBodySanitizerIdempotent(input: string): boolean {
  const once = sanitizeOutboundBodyHtml(input);
  const twice = sanitizeOutboundBodyHtml(once);
  return once === twice;
}
