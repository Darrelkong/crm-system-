import { mailMediaMatches } from "./client/mail-document-fit";
import postcss, { type ChildNode } from "postcss";
import { Parser } from "htmlparser2";

/** inbound-v6: a bounded AST allowlist, not a general CSS sanitizer. */
export const MAIL_CSS_LIMITS = { bytes: 65536, rules: 256, declarations: 2048 } as const;
const CLASS = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const TAG = /^(?:p|div|span|a|ul|ol|li|blockquote|pre|code|h[1-6]|table|thead|tbody|tfoot|caption|tr|th|td|strong|b|em|i)$/;


function selectorAllowed(selector: string): boolean {
  if (selector.length > 512) return false;
  const parts = selector.trim().split(/\s*>\s*|\s+/);
  return parts.length <= 8 && parts.every(part => {
    const [tag, ...classes] = part.split(".");
    return (TAG.test(tag) || (!tag && classes.length > 0)) && classes.length <= 8 && classes.every(c => CLASS.test(c));
  });
}

export function safeMailClasses(value: string | undefined, referenced: Set<string>): string | undefined {
  const classes = (value ?? "").split(/\s+/).filter(c => CLASS.test(c) && referenced.has(c)).slice(0, 32);
  return classes.length ? [...new Set(classes)].join(" ") : undefined;
}

export function sanitizeMailStylesheets(html: string, properties: Record<string, RegExp[]>): { css: string; classes: Set<string> } {
  const sheets: string[] = [];
  let inStyle = false, text = "", bytes = 0, overflow = false;
  const parser = new Parser({
    onopentag(name) { if (name === "style") { inStyle = true; text = ""; } },
    ontext(chunk) { if (inStyle) { bytes += chunk.length; if (bytes <= MAIL_CSS_LIMITS.bytes) text += chunk; else overflow = true; } },
    onclosetag(name) { if (name === "style") { inStyle = false; sheets.push(text); } },
  });
  parser.end(html);
  const classes = new Set<string>();
  if (overflow) return { css: "", classes };
  let rules = 0, declarations = 0;
  function emit(nodes: ChildNode[], media = false): string {
    let output = "";
    for (const node of nodes) {
      if (++rules > MAIL_CSS_LIMITS.rules) break;
      if (node.type === "atrule") {
        if (!media && node.name === "media" && mailMediaMatches(node.params, 390) !== null && node.nodes) {
          const inner = emit(node.nodes, true);
          if (inner) output += `@media ${node.params.toLowerCase().trim()}{${inner}}`;
        }
        continue;
      }
      if (node.type !== "rule" || node.nodes.some(n => n.type !== "decl" && n.type !== "comment")) continue;
      const selectors = node.selector.split(",").map(s => s.trim());
      if (selectors.length > 32 || !selectors.every(selectorAllowed)) continue;
      let body = "";
      for (const declaration of node.nodes) {
        if (declaration.type !== "decl" || ++declarations > MAIL_CSS_LIMITS.declarations) continue;
        const property = declaration.prop.toLowerCase(), value = declaration.value.trim();
        // Do not serialize raw AST strings, comments, escapes or arbitrary values.
        if (value.length > 256 || /[\\<>\u0000-\u001f\u007f]/.test(value)) continue;
        const allow = properties[property] ?? (property === "display" ? [/^(?:none|block|inline|inline-block|table|table-row|table-cell)$/] : property === "visibility" ? [/^(?:visible|hidden|collapse)$/] : []);
        if (allow.some(rule => rule.test(value))) body += `${property}:${value}${declaration.important ? "!important" : ""};`;
      }
      if (body) {
        for (const selector of selectors) for (const match of selector.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) classes.add(match[1]);
        output += `${selectors.join(",")}{${body}}`;
      }
    }
    return output;
  }
  let css = "";
  for (const sheet of sheets) {
    try { css += emit(postcss.parse(sheet).nodes); } catch { /* Malformed sheets fail closed. */ }
  }
  return { css, classes };
}
