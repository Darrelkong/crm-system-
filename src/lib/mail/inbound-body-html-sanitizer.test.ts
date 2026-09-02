import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isInboundBodySanitizerIdempotent,
  sanitizeInboundBodyHtml,
} from "@/lib/mail/inbound-body-html-sanitizer";

describe("inbound body HTML sanitizer", () => {
  it("removes executable and remote-tracking content", () => {
    const raw = `
      <html><body>
        <script>alert(1)</script>
        <p onclick="steal()">Hello</p>
        <a href="javascript:alert(1)">bad</a>
        <iframe src="https://evil.test"></iframe>
        <form action="/x"><input type="text"><button>Go</button></form>
        <textarea>bad</textarea><select><option>bad</option></select>
        <object data="https://evil.test/x"></object>
        <embed src="https://evil.test/x" />
        <svg onload="steal()"><circle /></svg>
        <canvas>bad</canvas>
        <meta http-equiv="refresh" content="0;url=https://evil.test" />
        <link rel="stylesheet" href="https://evil.test/style.css" />
        <audio src="https://evil.test/a.mp3"></audio>
        <video src="https://evil.test/v.mp4"></video>
        <img src="https://tracker.test/pixel.gif" width="1" height="1" />
        <p>Safe text</p>
      </body></html>
    `;
    const sanitized = sanitizeInboundBodyHtml(raw);
    assert.ok(sanitized);
    assert.match(sanitized, /Safe text/);
    assert.doesNotMatch(sanitized, /<script/i);
    assert.doesNotMatch(sanitized, /onclick/i);
    assert.doesNotMatch(sanitized, /javascript:/i);
    assert.doesNotMatch(sanitized, /<iframe/i);
    assert.doesNotMatch(sanitized, /<form/i);
    assert.doesNotMatch(sanitized, /<textarea|<select|<object|<embed|<svg|<canvas|<meta|<link|<audio|<video/i);
    assert.doesNotMatch(sanitized, /<img/i);
  });

  it("is idempotent for hostile input", () => {
    const raw =
      '<div><script>x</script><p>Hello</p><img src="https://x.test/a.png"></div>';
    assert.equal(isInboundBodySanitizerIdempotent(raw), true);
  });

  it("keeps useful formatting while rejecting active content and CSS escape paths", () => {
    const sanitized = sanitizeInboundBodyHtml(`
      <p style="font-weight:700;color:#123456">Heading</p>
      <ul><li>First</li><li>Second</li></ul>
      <table><tr><td>Cell</td></tr></table>
      <style>@import url("https://evil.test/style.css");</style>
      <div style="position:fixed;z-index:99999;background-image:url(https://evil.test/x)">
        <script>alert(1)</script>
        <p onerror="steal()">Safe body</p>
      </div>
    `);

    assert.ok(sanitized);
    assert.match(sanitized, /font-weight:700/);
    assert.match(sanitized, /color:#123456/);
    assert.match(sanitized, /<ul>/i);
    assert.match(sanitized, /<table>/i);
    assert.doesNotMatch(sanitized, /<style/i);
    assert.doesNotMatch(sanitized, /position\s*:/i);
    assert.doesNotMatch(sanitized, /z-index/i);
    assert.doesNotMatch(sanitized, /url\(/i);
    assert.doesNotMatch(sanitized, /<script|onerror/i);
  });

  it("allows only safe absolute links and adds opener protection", () => {
    const sanitized = sanitizeInboundBodyHtml(`
      <a href="https://example.com/path">safe</a>
      <a href="javascript:alert(1)">javascript</a>
      <a href="data:text/html;base64,abc">data</a>
      <a href="vbscript:msgbox(1)">vbscript</a>
      <a href="/admin">relative</a>
      <a href="//evil.test">protocol-relative</a>
      <a href="https://example.com" target="_blank" rel="opener">new tab</a>
    `);

    assert.ok(sanitized);
    assert.match(sanitized, /href="https:\/\/example\.com\/path"/);
    assert.match(sanitized, /target="_blank" rel="noopener noreferrer"/);
    assert.doesNotMatch(sanitized, /javascript:|data:|vbscript:|\/admin|evil\.test/i);
  });

  it("returns null for empty or active-content-only HTML", () => {
    assert.equal(sanitizeInboundBodyHtml("   "), null);
    assert.equal(
      sanitizeInboundBodyHtml("<script>alert(1)</script><iframe src='x'></iframe>"),
      null,
    );
  });
});
