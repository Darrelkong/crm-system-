import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteImageUrl, inertMailImages, decodeInertImage } from "./inert-image";
import { sanitizeInboundBodyHtml, isInboundBodySanitizerIdempotent } from "./inbound-body-html-sanitizer";
import { resolveMailMessageBody } from "./client/mail-message-body";
import { buildMailIsolatedDocument } from "./client/mail-isolated-document";
import { sanitizeOutboundBodyHtml } from "./outbound-body-html-sanitizer";
import { parseInboundMimeBytes } from "./inbound-mime-parser";

for (const bad of ['javascript:alert(1)','data:image/png,a','cid:hero','//remote.invalid/a','/api/mail','https://user:pass@remote.invalid','http://remote.invalid/\nfoo','https://remote.invalid\\evil','https://foo;bar/a']) test(`reject image URL ${JSON.stringify(bad)}`, () => assert.equal(remoteImageUrl(bad), null));
test("real sanitizer retains only inert validated image metadata, no resource attributes", () => {
  const raw='<img src="https://remote.invalid/banner.png?a=1&amp;b=2" alt="Banner &amp; &lt;safe&gt;" width="600" height="240" srcset="https://bad.invalid/a" onerror="evil()" style="background:url(https://bad.invalid/a)">';
  const html=sanitizeInboundBodyHtml(raw)!;
  assert.deepEqual(inertMailImages(html),[{url:'https://remote.invalid/banner.png?a=1&b=2',alt:'Banner & <safe>',width:600,height:240}]);
  assert.doesNotMatch(html, /<img|\ssrc=|srcset|onerror|url\(/);
  assert.ok(isInboundBodySanitizerIdempotent(raw));
});
test("image-only with no alt is meaningful but arbitrary/forged empty spans are not", () => {
  const html=sanitizeInboundBodyHtml('<table><tr><td><img src="https://remote.invalid/a"></td></tr></table>')!;
  assert.equal(resolveMailMessageBody({bodyHtml:html,bodyText:'fallback'}).mode,'html');
  for(const empty of ['<span></span>','<span data-mail-image-v1="javascript:evil"></span>','<!--'+html+'-->']) assert.equal(resolveMailMessageBody({bodyHtml:empty,bodyText:'fallback'}).mode,'plain_text');
  assert.equal(decodeInertImage('%oops'),null);
});
test("tiny metadata persists, dimensions bounded, descriptor forgery revalidates", () => {
  const html=sanitizeInboundBodyHtml('<img src="http://remote.invalid/pixel" width="1" height="1"><img src="http://remote.invalid/banner" width="99999" height="-1"><span data-mail-image-v1="bad" onclick="evil()"></span>')!;
  assert.deepEqual(inertMailImages(html).map(i=>[i.width,i.height]),[[1,1],[null,null]]);
  assert.doesNotMatch(html,/onclick|99999/);
});
test("CSP default blocks all images; opt-in permits only represented origins, never active content", () => {
  const html=sanitizeInboundBodyHtml('<img src="https://remote.invalid/a"><img src="http://127.0.0.1:3399/banner.png">')!;
  assert.match(buildMailIsolatedDocument(html),/img-src 'none'/);
  assert.match(buildMailIsolatedDocument(html,true),/img-src https:\/\/remote.invalid http:\/\/127.0.0.1:3399/);
  assert.match(buildMailIsolatedDocument(html,true),/script-src 'none'/);
  assert.doesNotMatch(buildMailIsolatedDocument(html,true),/<img|srcset|<script/);
});
test("outbound policy cannot turn reader descriptors into images or tracking URLs", () => {
  const html=sanitizeInboundBodyHtml('<p>Quote</p><img src="https://remote.invalid/tracker" alt="alt">')!;
  const outgoing=sanitizeOutboundBodyHtml(html);
  assert.match(outgoing,/Quote/);
  assert.doesNotMatch(outgoing,/data-mail-image|remote.invalid|<img|src=/);
});
test("CID parser has identity/disposition in memory; unsupported CID is not invented as remote", async () => {
  const mime='From: s@example.invalid\r\nTo: r@example.invalid\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=x\r\n\r\n--x\r\nContent-Type: text/html\r\n\r\n<img src="cid:hero-logo@example" alt="ECHFRONT">\r\n--x\r\nContent-Type: image/png\r\nContent-ID: <hero-logo@example>\r\nContent-Disposition: inline; filename="hero.png"\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--x--';
  const parsed=await parseInboundMimeBytes(new TextEncoder().encode(mime));
  assert.equal(parsed.attachments[0].disposition,'inline');
  assert.match(parsed.attachments[0].contentId!,/hero-logo@example/);
  assert.equal(inertMailImages(parsed.bodyHtmlSanitized ?? '').length,0);
});

test("hidden sender preheader alone cannot hide a blocked image or replace plain fallback", () => {
  const html=sanitizeInboundBodyHtml('<div style="display:none;max-height:0;opacity:0"><img src="https://remote.invalid/banner"></div>')!;
  assert.equal(resolveMailMessageBody({bodyHtml:html,bodyText:'fallback'}).mode,'html');
  assert.doesNotMatch(html,/display:none|max-height:0|opacity/);
  assert.equal(resolveMailMessageBody({bodyHtml:'<div></div>',bodyText:'real plain fallback'}).content,'real plain fallback');
});
