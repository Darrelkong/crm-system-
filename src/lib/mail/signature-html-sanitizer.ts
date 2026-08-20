import sanitizeHtml from "sanitize-html";
import { MailServiceError } from "@/lib/mail/errors";

/** Frozen sanitizer policy version — bump when allowlist changes (does not re-sanitize history). */
export const SIGNATURE_HTML_SANITIZER_POLICY_VERSION = "signature-v1";

const ALLOWED_TAGS = [
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
] as const;

const ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"] as const;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
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
        /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)$/,
      ],
      "font-size": [/^\d+(?:\.\d+)?(?:px|pt|em|%)$/],
      "font-family": [/^[a-zA-Z0-9\s,"'-]+$/],
      "font-weight": [/^(?:normal|bold|lighter|bolder|[1-9]00)$/],
      "font-style": [/^(?:normal|italic|oblique)$/],
      "text-decoration": [/^(?:none|underline|line-through|overline)$/],
      "text-align": [/^(?:left|right|center|justify)$/],
      "line-height": [/^\d+(?:\.\d+)?(?:px|em|%)?$/],
    },
  },
  allowedSchemes: [...ALLOWED_SCHEMES],
  allowProtocolRelative: false,
  transformTags: {
    a: (_tagName, attribs) => {
      const href = attribs.href?.trim();
      if (!href) {
        return { tagName: "a", attribs: {} };
      }
      const nextAttribs: Record<string, string> = { href };
      if (attribs.target === "_blank") {
        nextAttribs.target = "_blank";
        nextAttribs.rel = "noopener noreferrer";
      }
      return { tagName: "a", attribs: nextAttribs };
    },
  },
};

function stripHtmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sanitizes raw client signature HTML into canonical persisted semantic HTML.
 *
 * - Sanitization occurs once before persistence.
 * - Historical versions are never re-sanitized when policy changes.
 * - Inline `<img>` is not allowed until asset reference policy is frozen.
 */
export function sanitizeSignatureHtml(rawHtml: string): string {
  const trimmed = rawHtml.trim();
  if (!trimmed) {
    throw MailServiceError.validation("Signature HTML cannot be empty");
  }

  const sanitized = sanitizeHtml(trimmed, SANITIZE_OPTIONS).trim();
  if (!sanitized) {
    throw MailServiceError.validation(
      "Signature HTML contained no safe content after sanitization",
    );
  }

  const visibleText = stripHtmlToText(sanitized);
  if (!visibleText) {
    throw MailServiceError.validation(
      "Signature HTML contained no safe content after sanitization",
    );
  }

  return sanitized;
}

/** Returns null when raw HTML is absent; sanitizes non-empty input. */
export function sanitizeOptionalSignatureHtml(
  rawHtml: string | null | undefined,
): string | null {
  const trimmed = rawHtml?.trim();
  if (!trimmed) return null;
  return sanitizeSignatureHtml(trimmed);
}

export function isSignatureSanitizerIdempotent(input: string): boolean {
  const once = sanitizeSignatureHtml(input);
  const twice = sanitizeSignatureHtml(once);
  return once === twice;
}
