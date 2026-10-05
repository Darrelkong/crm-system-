import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeInboundBodyHtml as sanitize, isInboundBodySanitizerIdempotent, INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION } from "./inbound-body-html-sanitizer";
import { mailDocumentScale, mailMediaMatches } from "./client/mail-document-fit";
import { sanitizeQuoteHtml } from "./compose-body-html";

test("v6 preserves bounded rules, referenced classes and media with canonical idempotence", () => {
 const raw='<style>.mobile{display:none}.desktop{display:block}@media only screen and (max-width:600px){.mobile{display:block!important}.desktop{display:none}.layout td{padding:24px;color:#123}}</style><table class="layout unused"><tr><td class="mobile">Mobile</td><td class="desktop">Desktop</td></tr></table>';
 const html=sanitize(raw)!;
 assert.equal(INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION,'inbound-v6');
 for(const retained of ['<style>','.mobile{display:none;}','display:block!important','@media only screen and (max-width:600px)','class="layout"','class="mobile"','padding:24px']) assert.ok(html.includes(retained),retained);
 assert.ok(!html.includes('unused'));assert.ok(isInboundBodySanitizerIdempotent(raw));
});
for(const css of ['@import "https://evil.invalid/x";','@font-face{font-family:x;src:url(https://evil.invalid/f)}','.x{background:url(https://evil.invalid/i)}','.x{background-image:u\\72l(https://evil.invalid/i)}','.x{position:fixed;inset:0;z-index:999999;pointer-events:auto;opacity:0;animation:spin 1s;transform:scale(999)}','.x{width:expression(alert(1));--x:red;color:var(--x)}','@supports(display:grid){.x{display:none}}','@media(max-width:600px){@media(min-width:1px){.x{color:red}}}','.x:has(a[href]){display:none}','html,body,*{display:none}','.x{color:red; & .y{display:none}}']) test(`reject dangerous or unsupported stylesheet ${css}`,()=>{
 const html=sanitize(`<style>${css}</style><p class="x">Safe</p>`)!;assert.equal(html,'<p>Safe</p>');
});
test("mixed safe/unsafe declarations never trust classes and reject active markup",()=>{
 const html=sanitize('<style>.x{color:red;position:fixed;z-index:999999;background:url(https://evil.invalid/a)}</style><p class="x admin" onclick="evil()">Safe</p><script>evil()</script><iframe src="x"></iframe><svg onload="evil()"></svg><a href="javascript:evil()">link</a>')!;
 assert.match(html,/.x\{color:red;\}/);assert.match(html,/class="x"/);assert.doesNotMatch(html,/onclick|onload|<script|<svg|<iframe|javascript|z-index|position|url\(/);
});
test("malformed sheets and oversized CSS fail closed, no raw closing-tag serialization",()=>{
 assert.equal(sanitize('<style>.x{color:red</style><p class="x">Safe</p>'),'<p>Safe</p>');
 assert.equal(sanitize('<style>'+'.x{color:red}'.repeat(6000)+'</style><p class="x">Safe</p>'),'<p>Safe</p>');
 assert.doesNotMatch(sanitize('<style>.x{font-family:"</style><img src=x onerror=evil()>"}</style><p>Safe</p>')!, /onerror|<img/);
});
test("media bounds are exact and unsupported expressions fail closed",()=>{
 assert.equal(mailMediaMatches('screen and (max-width:600px)',358),true);assert.equal(mailMediaMatches('(max-width:600px)',832),false);
 assert.equal(mailMediaMatches('(min-width:601px) and (max-width:1200px)',832),true);
 for(const q of ['print','(width:100px)','(max-width:100vw)','(max-width:99999px)','(max-width:600px), all']) assert.equal(mailMediaMatches(q,390),null);
});
test("fit proportions, desktop and original mode are independent of canonical content",()=>{
 assert.equal(mailDocumentScale(358,358,true,false),1);assert.equal(mailDocumentScale(358,800,true,false),358/800);
 assert.equal(mailDocumentScale(358,22000,true,false),358/22000);assert.equal(mailDocumentScale(358,800,true,true),1);assert.equal(mailDocumentScale(832,800,false,false),1);
});
test("quote-v1 outbound policy does not gain stylesheet/class support or private URLs",()=>{
 const html=sanitize('<style>.x{color:red}</style><p class="x">Safe</p><img src="cid:a@b"><img src="https://example.invalid/pixel">')!;
 for(const delivery of [false,true]) {const quote=sanitizeQuoteHtml(html,delivery)!;assert.doesNotMatch(quote,/<style|class=|\/api\/mail/);assert.match(quote,/Safe/);if(delivery)assert.doesNotMatch(quote,/data-mail-(cid|image)/);}
});
