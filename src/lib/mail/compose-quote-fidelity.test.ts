import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReplyQuoteBody, buildForwardQuoteBody } from "./compose-draft-quote";
import { sanitizeComposeBodyHtml } from "./compose-body-html";
import { sanitizeInboundBodyHtml } from "./inbound-body-html-sanitizer";
import { splitComposeBodyForEditor, mergeComposeBodyForSave } from "./client/compose-reply-body";
import { inertMailCids } from "./cid-image";
import { inertMailImages } from "./inert-image";
import { resolveMailMessageBody } from "./client/mail-message-body";
const message = { fromAddress:"sender@example.com", fromDisplayName:"Synthetic Sender", direction:"inbound" as const, receivedAt:"2026-10-03T00:00:00Z", sentAt:null, subject:"Synthetic <subject>" };
const source = (html:string|null, text="") => ({ bodyHtmlSanitized:html, bodyText:text, quotedHtmlSanitized:null, quotedText:null });
function reply(html:string|null,text=""){ return buildReplyQuoteBody({message,source:source(html,text)}).bodyHtml!; }
for(const mode of ["reply","reply_all","forward"] as const) test(`${mode}: safe table/layout survives seed, autosave, reload and immutable delivery sanitization`,()=>{
 const html='<table width="600" cellpadding="24" style="max-width:100%;border:1px solid navy;background-color:#eee"><tr><td><h1 style="font-family:Georgia;font-size:32px">Heading</h1><p style="margin:20px;padding:12px">Safe text</p></td></tr></table>';
 const seeded=mode==='forward'?buildForwardQuoteBody({message,visibleRecipients:[],source:source(html)}).bodyHtml!:reply(html);
 const split=splitComposeBodyForEditor({bodyHtml:seeded,composeMode:mode});assert.equal(split.editableHtml,"");assert.ok(split.quotedHtml);
 const combined=mergeComposeBodyForSave({editableHtml:'<p>New answer</p>',quotedHtml:split.quotedHtml,composeMode:mode});
 const saved=sanitizeComposeBodyHtml(combined,mode)!;assert.equal(sanitizeComposeBodyHtml(saved,mode),saved);
 for(const body of [saved,sanitizeComposeBodyHtml(saved,mode,true)!]){assert.match(body,/<table width="600" cellpadding="24"/);assert.match(body,/max-width:100%/);assert.match(body,/font-family:Georgia/);assert.match(body,/margin:20px;padding:12px/);assert.match(body,/<p>New answer<\/p>/);}
});
test('plain text preserves line breaks, literals and safe links without malformed pre removal',()=>{
 const body=reply(null,'First <not html>\nSecond & third\n\nLast');assert.match(body,/<pre>First &lt;not html&gt;\nSecond &amp; third/);assert.equal(sanitizeComposeBodyHtml(body,'reply',true),body);
});
test('current body AND separate previous history retained, in chronological quote nesting',()=>{
 const body=buildReplyQuoteBody({message,source:{...source('<p>Current</p>','Current'),quotedHtmlSanitized:'<blockquote><p>Previous</p></blockquote>',quotedText:'Previous'}});
 assert.ok(body.bodyHtml!.indexOf('Current')<body.bodyHtml!.indexOf('Previous'));assert.match(body.bodyText,/Current\n\nPrevious/);
 const repeated=reply(body.bodyHtml);assert.equal((repeated.match(/<blockquote>/g)||[]).length,(repeated.match(/<\/blockquote>/g)||[]).length);assert.match(repeated,/Current/);assert.match(repeated,/Previous/);
});
test('forward includes escaped original metadata and excludes Bcc',()=>{
 const b=buildForwardQuoteBody({message,visibleRecipients:[{recipientType:'to',address:'to@example.com',displayName:null,sortOrder:0},{recipientType:'cc',address:'cc@example.com',displayName:null,sortOrder:1},{recipientType:'bcc',address:'secret@example.com',displayName:null,sortOrder:2}],source:source('<p>Body</p>')}).bodyHtml!;
 for(const key of ['Forwarded message','From:','Date:','Subject:','To:','Cc:','&lt;subject&gt;'])assert.ok(b.includes(key));assert.doesNotMatch(b,/secret@example|Bcc:/);
});
for(const [name,img] of [['CID','<img src="cid:Logo@Example" alt="Synthetic logo">'],['remote','<img src="https://canary.invalid/banner.png" alt="Banner">'],['tracking','<img src="https://canary.invalid/pixel" width="1" height="1">']])test(`${name}: image-only quote remains meaningful/inert, delivery has descriptions only`,()=>{
 const b=reply(sanitizeInboundBodyHtml(img));assert.equal(resolveMailMessageBody({bodyHtml:b,bodyText:''}).mode,'html');assert.doesNotMatch(b,/<img|src=|srcset=/i);assert.equal(inertMailCids(b).length+inertMailImages(b).length,1);
 const out=sanitizeComposeBodyHtml(b,'reply',true)!;assert.match(out,/image not included/);assert.doesNotMatch(out,/data-mail-|canary.invalid|Logo@Example|\/api\/mail|<img/i);assert.equal(sanitizeComposeBodyHtml(out,'reply',true),out);
});
test('hostile quote cannot retain active tags, overlay CSS, CSS URLs or private renderer URLs',()=>{
 const b=reply('<style>@import "https://attack.invalid"</style><script>alert(1)</script><form><input></form><iframe src="https://attack.invalid"></iframe><svg onload="x()"></svg><p style="position:fixed;z-index:9999;background:url(https://attack.invalid);color:red" onclick="x()">Safe</p><a href="javascript:alert(1)">Bad</a><img src="/api/mail/messages/other/inline-resources/private">');
 assert.doesNotMatch(b,/<script|<form|<input|<iframe|<svg|onclick|onload|position:|z-index|url\(|@import|javascript:|\/api\/mail/i);assert.match(b,/Safe/);
});
test('editable content and new compose do not gain quote formatting/image permissions',()=>{
 const html='<table><tr><td>New</td></tr></table>';
 assert.doesNotMatch(sanitizeComposeBodyHtml(html,'new')!,/<table/);
 const b=mergeComposeBodyForSave({editableHtml:'<p>New</p><img src="cid:x@example">',quotedHtml:splitComposeBodyForEditor({bodyHtml:reply('<p>Old</p>'),composeMode:'reply'}).quotedHtml,composeMode:'reply'});
 assert.throws(()=>sanitizeComposeBodyHtml(b,'reply'),/Inline body images/);
});
test('long/wide enterprise and Apple-like hierarchy is not shortened',()=>{
 const html='<h1 style="font-size:48px;padding:24px">Synthetic Apple hierarchy</h1><pre>'+('WIDE_'.repeat(1000))+'</pre>'+('<p style="margin:20px">Long paragraph</p>'.repeat(10000))+'<p>ACTUAL_END_M1F</p>';
 const b=reply(html);const out=sanitizeComposeBodyHtml(b,'reply',true)!;assert.match(out,/font-size:48px;padding:24px/);assert.equal((out.match(/Long paragraph/g)||[]).length,10000);assert.match(out,/ACTUAL_END_M1F/);assert.match(out,/<pre>WIDE_/);
});
test('hostile image alt stays escaped text when frozen for delivery',()=>{
 const b=reply('<img src="cid:Logo@Example" alt="&lt;script&gt;evil()&lt;/script&gt;&lt;img src=x onerror=evil()&gt;">');
 const out=sanitizeComposeBodyHtml(b,'reply',true)!;
 assert.doesNotMatch(out,/<script|<img|<\/span>.*onerror/i);
 assert.match(out,/&lt;script&gt;/);
});

test('HTML-only originals retain a plain-text MIME fallback, including image descriptions',()=>{
 const quoted=buildReplyQuoteBody({message,source:source('<p>HTML only body</p><img src="cid:Logo@Example" alt="Logo">')});
 assert.match(quoted.bodyText,/HTML only body/);assert.match(quoted.bodyText,/Inline image not included.*Logo/);
});
