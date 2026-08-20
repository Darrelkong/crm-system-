import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSignatureSanitizerIdempotent,
  sanitizeSignatureHtml,
} from "@/lib/mail/signature-html-sanitizer";
import { MailServiceError } from "@/lib/mail/errors";

describe("signature html sanitizer", () => {
  it("preserves safe rich text formatting", () => {
    const input =
      '<p style="color:#333333;font-size:14px;">Hello <strong>Daniel</strong></p>';
    const sanitized = sanitizeSignatureHtml(input);
    assert.match(sanitized, /Hello/);
    assert.match(sanitized, /Daniel/);
    assert.match(sanitized, /strong/);
    assert.doesNotMatch(sanitized, /script/i);
  });

  it("removes script tags and active content", () => {
    const sanitized = sanitizeSignatureHtml(
      '<p>Hi</p><script>alert(1)</script>',
    );
    assert.doesNotMatch(sanitized, /script/i);
    assert.match(sanitized, /Hi/);
  });

  it("removes event handler attributes", () => {
    const sanitized = sanitizeSignatureHtml(
      '<img src="x" onerror="alert(1)"><p onclick="evil()">Text</p>',
    );
    assert.doesNotMatch(sanitized, /onerror/i);
    assert.doesNotMatch(sanitized, /onclick/i);
    assert.doesNotMatch(sanitized, /<img/i);
    assert.match(sanitized, /Text/);
  });

  it("rejects javascript: links", () => {
    const sanitized = sanitizeSignatureHtml(
      '<a href="javascript:alert(1)">Click</a>',
    );
    assert.doesNotMatch(sanitized, /javascript:/i);
  });

  it("allows safe https and mailto links", () => {
    const sanitized = sanitizeSignatureHtml(
      '<a href="https://example.com">Site</a> <a href="mailto:a@b.com">Mail</a>',
    );
    assert.match(sanitized, /https:\/\/example\.com/);
    assert.match(sanitized, /mailto:a@b\.com/);
  });

  it("removes iframe/object/embed", () => {
    const sanitized = sanitizeSignatureHtml(
      '<iframe src="https://evil.com"></iframe><p>Keep</p>',
    );
    assert.doesNotMatch(sanitized, /iframe/i);
    assert.match(sanitized, /Keep/);
  });

  it("rejects dangerous-only HTML input", () => {
    assert.throws(
      () => sanitizeSignatureHtml("<script>alert(1)</script>"),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("is idempotent for representative content", () => {
    const input = '<p><em>Regards</em>, <span style="font-weight:bold;">Team</span></p>';
    assert.equal(isSignatureSanitizerIdempotent(input), true);
    const once = sanitizeSignatureHtml(input);
    const twice = sanitizeSignatureHtml(once);
    assert.equal(once, twice);
  });

  it("sanitizes malformed nested HTML deterministically", () => {
    const a = sanitizeSignatureHtml("<p><strong><p>Nested</strong></p>");
    const b = sanitizeSignatureHtml("<p><strong><p>Nested</strong></p>");
    assert.equal(a, b);
  });
});
