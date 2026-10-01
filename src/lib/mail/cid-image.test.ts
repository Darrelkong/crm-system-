import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeContentIdHeader, normalizeHtmlCid, validNormalizedContentId, inertMailCids, decodeInertCid, mailInlineResourcePath } from "./cid-image";
import { sanitizeInboundBodyHtml, INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION } from "./inbound-body-html-sanitizer";
import { resolveMailMessageBody } from "./client/mail-message-body";
import { buildMailIsolatedDocument } from "./client/mail-isolated-document";
import { sanitizeOutboundBodyHtml } from "./outbound-body-html-sanitizer";
import { buildMailInlineResourceMap, validatedInlineImageType } from "./mail-inline-resource-service";

for (const [input, expected] of [[" \t<Foo+%40@example>\t", "Foo+%40@example"], ["foo@example", "foo@example"], ["<x%2Fy@Host>", "x%2Fy@Host"]]) {
  test(`header normalization ${input}`, () => assert.equal(normalizeContentIdHeader(input), expected));
}
for (const bad of ["", "<>", "foo", " <a@b>\n", "<<a@b>>", "<a@b", "a@b>", "a @b", "a@ b", "é@b", "a@b\0", "a@b\n", "a..b@c", '"a"@b', "a@[127.0.0.1]", "a".repeat(997)+"@b"]) {
  test(`reject malformed CID ${JSON.stringify(bad)}`, () => { assert.equal(normalizeContentIdHeader(bad), null); assert.equal(validNormalizedContentId(bad), false); });
}
test("HTML CID scheme and percent decoding once, case and plus preserved", () => {
  assert.equal(normalizeHtmlCid("CiD:Foo%2B%2540%40Example"), "Foo+%40@Example");
  assert.equal(normalizeHtmlCid("cid:a+b@c"), "a+b@c");
  for (const bad of ["https://a@b", "cid:%zz", "cid:a%20@b", "cid:%3Ca@b%3E", "cid:a%00@b", "cid:a%2540b"]) assert.equal(normalizeHtmlCid(bad), null);
});
test("v5 canonical descriptor contains only normalized safe metadata and is idempotent", () => {
  assert.equal(INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION, "inbound-v5");
  const html = sanitizeInboundBodyHtml('<img src="CID:Logo%40Example" alt="&lt;Logo&gt;" width="600" height="240" onerror="evil()" srcset="https://bad.invalid/a" style="background:url(https://bad.invalid/a)">')!;
  assert.deepEqual(inertMailCids(html), [{cid:"Logo@Example",alt:"<Logo>",width:600,height:240}]);
  assert.doesNotMatch(html, /<img|\ssrc=|srcset|onerror|url\(|attachmentId|messageId/);
  assert.equal(sanitizeInboundBodyHtml(html), html);
  assert.equal(decodeInertCid("bad"), null);
});
test("CID image-only is meaningful; arbitrary empty/invalid/commented descriptors are not", () => {
  const html = sanitizeInboundBodyHtml('<img src="cid:a@b">')!;
  assert.equal(resolveMailMessageBody({bodyHtml:html,bodyText:""}).mode, "html");
  for (const empty of ['<span></span>', '<span data-mail-cid-v1="bad"></span>', `<!--${html}-->`]) assert.equal(resolveMailMessageBody({bodyHtml:empty,bodyText:"fallback"}).content, "fallback");
  assert.match(sanitizeInboundBodyHtml('<img src="cid:bad" alt="&lt;script&gt;">')!, /Inline image unavailable/);
  assert.doesNotMatch(sanitizeInboundBodyHtml('<img src="cid:bad" alt="&lt;script&gt;">')!, /<script>/);
});
const row = (id:string, mime="image/png") => ({attachment:{id,contentIdNormalized:"a@b",contentDisposition:"inline",deliveryMode:"direct_attachment",mimeType:mime},securityScanStatus:"unscanned",trustedMimeType:mime});
test("bounded resource map counts ALL duplicates before MIME filtering and never guesses", () => {
  const html = sanitizeInboundBodyHtml('<img src="cid:a@b"><img src="cid:a@b"><img src="cid:A@b"><img src="cid:missing@b">')!;
  assert.deepEqual(buildMailInlineResourceMap(html,[row("one")]),[{cid:"a@b",attachmentId:"one"},{cid:"A@b",attachmentId:null},{cid:"missing@b",attachmentId:null}]);
  assert.equal(buildMailInlineResourceMap(html,[row("one"),row("two","application/pdf")])[0].attachmentId,null);
  assert.equal(buildMailInlineResourceMap(html,[row("one"),{...row("two"),trustedMimeType:null,securityScanStatus:null}])[0].attachmentId,null);
  assert.equal(buildMailInlineResourceMap(html,[{...row("one"),securityScanStatus:"blocked"}])[0].attachmentId,null);
});
test("trusted path uses message/attachment IDs, never raw CID or sender URL", () => {
  const context={messageId:"message",folder:"inbox",resources:[{cid:"a@b",attachmentId:"attachment"}]};
  assert.equal(mailInlineResourcePath(context,"a@b"),"/api/mail/messages/message/inline-resources/attachment?folder=inbox");
  assert.equal(mailInlineResourcePath(context,"https://sender.invalid"),null);
  assert.equal(mailInlineResourcePath({...context,resources:[...context.resources,...context.resources]},"a@b"),null);
});
test("only matching declared PNG/JPEG byte signatures accepted", () => {
  const png=new Uint8Array([137,80,78,71,13,10,26,10]); const jpeg=new Uint8Array([255,216,255]);
  assert.equal(validatedInlineImageType(png,"image/png"),"image/png");
  assert.equal(validatedInlineImageType(jpeg,"image/jpeg"),"image/jpeg");
  for (const mime of ["image/jpeg","image/svg+xml","text/html","application/pdf","application/octet-stream"]) assert.equal(validatedInlineImageType(png,mime),null);
  assert.equal(validatedInlineImageType(new TextEncoder().encode("<html>"),"image/png"),null);
});
test("CID CSP and outbound boundary do not enable remote requests or outbound image URLs", () => {
  const html=sanitizeInboundBodyHtml('<p>Quote</p><img src="cid:logo@example"><img src="https://sender.invalid/track">')!;
  const doc=buildMailIsolatedDocument(html,false,true);
  assert.match(doc,/img-src 'self';/); assert.match(doc,/script-src 'none'/);
  assert.doesNotMatch(doc,/<img|\ssrc=/);
  const quote=sanitizeOutboundBodyHtml(html);
  assert.doesNotMatch(quote,/data-mail-cid|data-mail-image|\/inline-resources\/|<img|sender.invalid/);
  assert.match(quote,/Quote/);
});
