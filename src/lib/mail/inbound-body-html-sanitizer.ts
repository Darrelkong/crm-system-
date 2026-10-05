import { safeMailClasses, sanitizeMailStylesheets } from "./mail-responsive-css";
import { MAIL_CID_ATTRIBUTE, normalizeHtmlCid, encodeInertCid, decodeInertCid } from "./cid-image";
import sanitizeHtml from "sanitize-html";
import { MAIL_IMAGE_ATTRIBUTE, remoteImageUrl, imageDimension, encodeInertImage, decodeInertImage } from "./inert-image";

/** Frozen inbound HTML policy — bump when allowlist changes (does not re-sanitize history). */
export const INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION = "inbound-v6";

export const INBOUND_BODY_ALLOWED_TAGS = [
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
  "tfoot",
  "caption",
  "hr",
  "sub",
  "sup",
  "tr",
  "th",
  "td",
] as const;

// sanitize-html parses declarations with its existing PostCSS dependency. These
// anchored value grammars are an allowlist, never a parser for arbitrary CSS.
const COLOR = String.raw`(?:transparent|currentcolor|black|white|gray|silver|red|maroon|yellow|olive|lime|green|aqua|teal|blue|navy|fuchsia|purple|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9%+,\s.-]{1,80}\))`;
const LENGTH = String.raw`(?:0|(?:[0-9]{1,3}|1[0-9]{3}|2000)(?:\.[0-9]{1,2})?(?:px|pt)|[0-9]{1,2}(?:\.[0-9]{1,2})?(?:em|rem)|(?:[0-9]{1,2}|100)(?:\.[0-9]{1,2})?%)`;
const SPACE = String.raw`(?:0|[0-9]{1,2}(?:\.[0-9]{1,2})?(?:px|pt|em|rem|%))`;
const SAFE_CSS_COLOR = new RegExp(`^${COLOR}$`, "i");
const SAFE_CSS_SIZE = new RegExp(`^${LENGTH}$`, "i");
const SAFE_SPACE = new RegExp(`^${SPACE}(?:\\s+${SPACE}){0,3}$`, "i");
const SAFE_MARGIN = new RegExp(`^(?:auto|${SPACE})(?:\\s+(?:auto|${SPACE})){0,3}$`, "i");
const SAFE_BORDER = new RegExp(`^(?:0|none|(?:[0-9]|1[0-9]|20)(?:px|pt) (?:solid|dashed|dotted|double) ${COLOR})$`, "i");
const FAMILY = String.raw`(?:Arial|Helvetica|Verdana|Georgia|Tahoma|Trebuchet MS|Times New Roman|Courier New|sans-serif|serif|monospace|system-ui)`;
const SAFE_FONT_FAMILY = new RegExp(`^(?:${FAMILY}|"${FAMILY}"|'${FAMILY}')(?:,\\s*(?:${FAMILY}|"${FAMILY}"|'${FAMILY}')){0,7}$`, "i");

function layoutAttributes(attributes: Record<string, string>) {
  const result = { ...attributes };
  const rules: Record<string, RegExp> = {
    width: /^(?:[1-9][0-9]{0,3}|(?:[1-9][0-9]?|100)%)$/,
    cellpadding: /^(?:0|[1-9][0-9]?)$/,
    cellspacing: /^(?:0|[1-9][0-9]?)$/,
    border: /^(?:0|[1-9]|1[0-9]|20)$/,
    colspan: /^[1-9][0-9]?$/,
    rowspan: /^[1-9][0-9]?$/,
    align: /^(?:left|right|center|justify)$/i,
    valign: /^(?:top|middle|bottom|baseline)$/i,
    bgcolor: SAFE_CSS_COLOR,
  };
  for (const [name, rule] of Object.entries(rules)) {
    if (result[name] && !rule.test(result[name])) delete result[name];
  }
  return result;
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...INBOUND_BODY_ALLOWED_TAGS],
  disallowedTagsMode: "discard",
  allowedAttributes: {
    "*": ["style"],
    a: ["href", "target", "rel"],
    span: [MAIL_IMAGE_ATTRIBUTE, MAIL_CID_ATTRIBUTE],
    table: ["width", "cellpadding", "cellspacing", "border", "align", "bgcolor"],
    tr: ["align", "valign", "bgcolor"],
    th: ["colspan", "rowspan", "width", "align", "valign", "bgcolor"],
    td: ["colspan", "rowspan", "width", "align", "valign", "bgcolor"],
  },
  allowedStyles: {
    "*": {
      width: [SAFE_CSS_SIZE, /^auto$/],
      "max-width": [SAFE_CSS_SIZE],
      padding: [SAFE_SPACE],
      margin: [SAFE_MARGIN],
      ...Object.fromEntries(["top", "right", "bottom", "left"].flatMap(side => [
        [`padding-${side}`, [new RegExp(`^${SPACE}$`, "i")]],
        [`margin-${side}`, [new RegExp(`^(?:auto|${SPACE})$`, "i")]],
        [`border-${side}`, [SAFE_BORDER]],
      ])),
      border: [SAFE_BORDER],
      "border-collapse": [/^(?:collapse|separate)$/],
      "border-spacing": [SAFE_SPACE],
      "border-radius": [SAFE_SPACE],
      "table-layout": [/^(?:auto|fixed)$/],
      "font-family": [SAFE_FONT_FAMILY],
      "white-space": [/^(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)$/],
      "word-break": [/^(?:normal|break-all|keep-all|break-word)$/],
      "overflow-wrap": [/^(?:normal|break-word|anywhere)$/],
      color: [SAFE_CSS_COLOR],
      "background-color": [SAFE_CSS_COLOR],
      "font-weight": [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
      "font-style": [/^(?:normal|italic|oblique)$/i],
      "text-decoration": [
        /^(?:none|underline|overline|line-through)(?:\s+(?:solid|dotted|dashed))?$/i,
      ],
      "text-align": [/^(?:left|right|center|justify|start|end)$/i],
      "vertical-align": [/^(?:baseline|top|middle|bottom|sub|super)$/i],
      "font-size": [SAFE_CSS_SIZE],
      "line-height": [/^(?:normal|[1-9][0-9]{0,2}(?:\.[0-9]{1,2})?(?:px|pt|em|rem|%)?)$/i],
    },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: {
    "*": (tagName, attribs) => ({ tagName, attribs: layoutAttributes(attribs) }),
    img: (_tagName, attribs): sanitizeHtml.Tag => {
      if (/^cid:/i.test(attribs.src ?? "")) {
        const cid = normalizeHtmlCid(attribs.src);
        return cid
          ? { tagName: "span", attribs: { [MAIL_CID_ATTRIBUTE]: encodeInertCid({ cid, alt: (attribs.alt ?? "").slice(0, 500), width: imageDimension(attribs.width), height: imageDimension(attribs.height) }) } }
          : { tagName: "span", attribs: {}, text: `[Inline image unavailable]${attribs.alt ? ` ${attribs.alt.slice(0, 500)}` : ""}` };
      }
      const url = remoteImageUrl(attribs.src ?? "");
      return { tagName: "span", attribs: url ? { [MAIL_IMAGE_ATTRIBUTE]: encodeInertImage({ url, alt: (attribs.alt ?? "").slice(0, 500), width: imageDimension(attribs.width), height: imageDimension(attribs.height) }) } : {} };
    },
    span: (tagName, attribs): sanitizeHtml.Tag => {
      const cid = decodeInertCid(attribs[MAIL_CID_ATTRIBUTE] ?? "");
      if (cid) return { tagName, attribs: { [MAIL_CID_ATTRIBUTE]: encodeInertCid(cid) } };
      const image = decodeInertImage(attribs[MAIL_IMAGE_ATTRIBUTE] ?? "");
      // An incoming reserved descriptor is subject to the same validation as img.
      // Descriptor styles are application-owned; sender CSS cannot hide it.
      return { tagName, attribs: image ? { [MAIL_IMAGE_ATTRIBUTE]: encodeInertImage(image) } : (attribs.style ? { style: attribs.style } : {}) };
    },
    a: (_tagName, attribs) => {
      const href = attribs.href?.trim();
      if (!href) return { tagName: "a", attribs: {} };
      const lower = href.toLowerCase();
      if (
        lower.startsWith("javascript:") ||
        lower.startsWith("data:") ||
        !/^(?:https?:\/\/|mailto:|tel:)/i.test(href)
      ) {
        return { tagName: "span", attribs: {}, text: "" };
      }
      const next: Record<string, string> = { href, target: "_blank", rel: "noopener noreferrer" };
      if (attribs.style) next.style = attribs.style;
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
 * V6 adds bounded parsed stylesheets/classes and width media rules. V5 CID and
 * V4 remote-image descriptors remain inert. No historical reprocessing.
 */
export function sanitizeInboundBodyHtml(rawHtml: string, responsiveStyles = true): string | null {
  const trimmed = rawHtml.trim();
  if (!trimmed) {
    return null;
  }

  const sheets = responsiveStyles ? sanitizeMailStylesheets(trimmed, SANITIZE_OPTIONS.allowedStyles!["*"]) : { css: "", classes: new Set<string>() };
  // Original style nodes are still discarded by sanitize-html. Only bounded,
  // newly serialized AST output is inserted; no raw stylesheet reaches a browser.
  const transforms = Object.fromEntries(Object.entries(SANITIZE_OPTIONS.transformTags!).map(([tag, transform]) => [tag, (name: string, attributes: Record<string, string>) => {
    const next = typeof transform === "function" ? transform(name, attributes) : { tagName: transform, attribs: attributes };
    const classes = safeMailClasses(attributes.class, sheets.classes);
    if (classes && !next.attribs[MAIL_IMAGE_ATTRIBUTE] && !next.attribs[MAIL_CID_ATTRIBUTE]) next.attribs.class = classes;
    else delete next.attribs.class;
    return next;
  }]));
  const body = sanitizeHtml(trimmed, { ...SANITIZE_OPTIONS, allowedAttributes: { ...SANITIZE_OPTIONS.allowedAttributes, "*": ["style", "class"] }, transformTags: transforms }).trim();
  const sanitized = body ? `${sheets.css ? `<style>${sheets.css}</style>` : ""}${body}` : "";
  if (!sanitized) {
    return null;
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
