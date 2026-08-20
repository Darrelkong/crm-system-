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
    assert.doesNotMatch(sanitized, /<img/i);
  });

  it("is idempotent for hostile input", () => {
    const raw =
      '<div><script>x</script><p>Hello</p><img src="https://x.test/a.png"></div>';
    assert.equal(isInboundBodySanitizerIdempotent(raw), true);
  });
});
