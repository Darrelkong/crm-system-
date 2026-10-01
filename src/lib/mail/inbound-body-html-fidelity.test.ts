import assert from "node:assert/strict";
import { test } from "node:test";
import { INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION, sanitizeInboundBodyHtml, isInboundBodySanitizerIdempotent } from "./inbound-body-html-sanitizer";
import { sanitizeOutboundBodyHtml } from "./outbound-body-html-sanitizer";
import { buildMailIsolatedDocument, MAIL_DOCUMENT_CSP, safeMailDocumentLink } from "./client/mail-isolated-document";

test("versioned v4 retains safe enterprise table presentation", () => {
  assert.equal(INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION, "inbound-v4");
  const html = '<table width="600" cellpadding="24" cellspacing="0" border="1" bgcolor="#eeeeee" style="width:600px;max-width:100%;border-collapse:collapse;margin:0 auto"><thead><tr><th colspan="2">Title</th></tr></thead><tbody><tr><td rowspan="2" valign="top" style="padding:24px 16px;border:1px solid #123456;background-color:#eee;font-family:Arial, Helvetica, sans-serif;font-size:24px;line-height:1.5;color:#123456">Body</td></tr></tbody><tfoot><tr><td>End</td></tr></tfoot></table>';
  const safe = sanitizeInboundBodyHtml(html)!;
  for (const retained of ['width="600"','cellpadding="24"','colspan="2"','rowspan="2"','max-width:100%','padding:24px 16px','border:1px solid #123456','font-family:Arial, Helvetica, sans-serif','<tfoot>']) assert.ok(safe.includes(retained), retained);
  assert.ok(isInboundBodySanitizerIdempotent(html));
});

for (const style of [
  'position:fixed;inset:0;z-index:999999', 'background:url(https://tracking.invalid/a)',
  'background-image:u\\72l(https://tracking.invalid/a)', '@import "https://tracking.invalid/import"',
  'width:expression(alert(1))', 'width:calc(100vw);height:100vh', '--evil:url(https://tracking.invalid/a);color:var(--evil)',
  'behavior:url(x);-moz-binding:url(x)', 'margin:-500px;transform:scale(999);opacity:0',
  'font-family:url(x)', 'color:red}body{background:url(https://tracking.invalid/a)',
]) test(`reject unsafe CSS: ${style}`, () => {
  const safe = sanitizeInboundBodyHtml(`<div class="escape" id="escape" style="${style}">SAFE_END</div>`)!;
  assert.match(safe, /SAFE_END/);
  assert.doesNotMatch(safe, /tracking|expression|fixed|z-index|import|behavior|binding|100vw|100vh|calc\(|var\(|url\(|opacity|transform|class=|id=/i);
});

test("stylesheet/class/image resources remain blocked", () => {
  const safe = sanitizeInboundBodyHtml('<style>@media(max-width:400px){p{color:red}}@import "https://tracking.invalid";</style><p class="wide">Text</p><img src="https://tracking.invalid/pixel" alt="secret"><img src="cid:x"><img src="data:image/png,abc">')!;
  assert.match(safe, /<p>Text<\/p>/);
  assert.match(safe, /data-mail-image-v1=/);
  assert.doesNotMatch(safe, /<style|class=|<img|\ssrc=|cid:|data:image/);
});

test("invalid layout attributes and active targets are removed", () => {
  const safe = sanitizeInboundBodyHtml('<table width="expression(x)" cellpadding="999999"><tr><td rowspan="-1" colspan="9999">Safe</td></tr></table><a href="https://example.invalid" target="_top" style="padding:8px;color:#123">Link</a>')!;
  assert.doesNotMatch(safe,/expression|999999|rowspan|colspan|_top/);
  assert.match(safe,/target="_blank" rel="noopener noreferrer"/);
  assert.match(safe,/padding:8px/);
});

test("reader document has fixed deny-network CSP and no executable boot script", () => {
  const old = '<p style="color:#123456">Old v2 text</p><blockquote>Quoted end</blockquote>';
  const doc = buildMailIsolatedDocument(old);
  assert.ok(doc.includes(old));
  assert.ok(doc.indexOf(MAIL_DOCUMENT_CSP) < doc.indexOf(old));
  assert.match(MAIL_DOCUMENT_CSP,/script-src 'none'/);
  assert.match(MAIL_DOCUMENT_CSP,/img-src 'none'/);
  assert.match(MAIL_DOCUMENT_CSP,/default-src 'none'/);
  assert.doesNotMatch(doc, /<script|allow-scripts/);
});

test("only explicit safe link schemes are eligible for trusted parent navigation", () => {
  for (const href of ['https://example.invalid','http://example.invalid','mailto:synthetic@example.invalid','tel:+123456']) assert.ok(safeMailDocumentLink(href));
  for (const href of ['javascript:alert(1)','java\nscript:alert(1)','data:text/html,hi','//example.invalid','/mail','file:///tmp/x']) assert.equal(safeMailDocumentLink(href),null);
});

test("expanded inbound fidelity does not expand outbound quote policy", () => {
  const inbound = sanitizeInboundBodyHtml('<table cellpadding="24"><tr><td style="padding:24px;border:1px solid #123;font-family:Georgia">Quote</td></tr></table>')!;
  const outbound = sanitizeOutboundBodyHtml(inbound);
  assert.match(outbound,/Quote/);
  assert.doesNotMatch(outbound, /<table|<td|cellpadding|padding|border|font-family/);
});
